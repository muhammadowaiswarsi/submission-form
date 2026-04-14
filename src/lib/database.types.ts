/**
 * Minimal Supabase schema typing for this app.
 * Extend when you add tables or run `supabase gen types typescript`.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      submissions: {
        Row: {
          id: string;
          identifier: string;
          type: string;
          file_url: string;
          status: string;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          identifier: string;
          type: string;
          file_url: string;
          status?: string;
          created_at?: string | null;
        };
        Update: {
          identifier?: string;
          type?: string;
          file_url?: string;
          status?: string;
          created_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
