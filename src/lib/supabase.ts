import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

/** Typed client — add tables to `database.types.ts` as your schema grows. */
export const supabase = createClient<Database>(supabaseUrl, supabaseKey);
