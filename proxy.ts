import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const envHost = process.env.OLYMPIA_HOST?.toLowerCase().trim();
const DEFAULT_PREFIX = "olympia.";

function isOlympiaHost(host: string | null): boolean {
  if (!host) return false;
  const normalized = host.toLowerCase();
  return envHost ? normalized === envHost : normalized.startsWith(DEFAULT_PREFIX);
}

function isSafeRedirect(value: string | null): value is string {
  return Boolean(value && value.startsWith("/") && !value.startsWith("//"));
}

function isPublicOlympiaRoute(pathname: string): boolean {
  return (
    pathname === "/olympia/mc" ||
    pathname.startsWith("/olympia/mc/") ||
    pathname.startsWith("/olympia/client/mc") ||
    pathname.startsWith("/olympia/client/guest") ||
    pathname.startsWith("/olympia/client/watch") ||
    pathname.startsWith("/olympia/client/join") ||
    pathname.startsWith("/olympia/client/how-to-join")
  );
}

function copyAuthCookies(source: NextResponse, target: NextResponse): NextResponse {
  source.cookies.getAll().forEach((cookie) => {
    target.cookies.set(cookie);
  });
  return target;
}

export async function proxy(request: NextRequest) {
  const host = request.headers.get("host");
  const { pathname } = request.nextUrl;
  const url = request.nextUrl.clone();

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/robots") ||
    pathname.startsWith("/sitemap")
  ) {
    return NextResponse.next();
  }

  const onOlympiaHost = isOlympiaHost(host);
  const isOlympiaPath = pathname.startsWith("/olympia");

  if (onOlympiaHost && !isOlympiaPath) {
    url.pathname = pathname === "/" ? "/olympia" : `/olympia${pathname}`;
    return NextResponse.rewrite(url);
  }

  if (!onOlympiaHost && isOlympiaPath && envHost) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.hostname = envHost;
    return NextResponse.redirect(redirectUrl);
  }

  const isLoginRoute = pathname === "/login";
  const isRootRoute = pathname === "/";
  const isProtectedLegacyRoute =
    pathname.startsWith("/admin") || pathname.startsWith("/client");
  const isProtectedOlympiaRoute = isOlympiaPath && !isPublicOlympiaRoute(pathname);
  const needsAuth =
    isLoginRoute || isRootRoute || isProtectedLegacyRoute || isProtectedOlympiaRoute;

  if (!needsAuth) return NextResponse.next();

  const supabaseResponse = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            supabaseResponse.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { data } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims?.sub);
  const finalize = (response: NextResponse) => copyAuthCookies(supabaseResponse, response);

  if (isLoginRoute && isAuthenticated) {
    const redirect = request.nextUrl.searchParams.get("redirect");
    const destination = isSafeRedirect(redirect) ? redirect : "/olympia";
    url.pathname = destination;
    url.search = "";
    return finalize(NextResponse.redirect(url));
  }

  if (isRootRoute) {
    url.pathname = "/olympia";
    url.search = "";
    return finalize(NextResponse.redirect(url));
  }

  if (isProtectedLegacyRoute || isProtectedOlympiaRoute) {
    if (!isAuthenticated) {
      url.pathname = "/login";
      url.search = "";
      url.searchParams.set("redirect", pathname);
      return finalize(NextResponse.redirect(url));
    }
  }

  return finalize(supabaseResponse);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
