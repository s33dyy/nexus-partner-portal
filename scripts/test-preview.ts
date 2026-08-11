import { supabase } from "./src/integrations/local/client.js";
async function run() {
  const { data, error } = await supabase.storage.from("partner-documents").createSignedUrl("test", 300);
  console.log({ data, error });
}
run();
