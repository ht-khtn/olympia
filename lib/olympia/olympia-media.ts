import { getSupabaseSync } from "@/lib/supabase";

export type OlympiaMediaFolder = "audio" | "theme" | "video";

export function getOlympiaMediaUrl(
  folder: OlympiaMediaFolder,
  fileName: string
): string {
  const objectPath = `${folder}/${fileName}`;
  const { data } = getSupabaseSync()
    .storage
    .from("olympia-media")
    .getPublicUrl(objectPath);

  return data.publicUrl;
}
