import getSupabase from "@/lib/supabase";

export type OlympiaMediaFolder = "audio" | "theme" | "video";

export async function getOlympiaMediaUrl(
  folder: OlympiaMediaFolder,
  fileName: string
): Promise<string> {
  const supabase = await getSupabase();
  const objectPath = `${folder}/${fileName}`;
  const { data } = supabase
    .storage
    .from("olympia-media")
    .getPublicUrl(objectPath);

  return data.publicUrl;
}
