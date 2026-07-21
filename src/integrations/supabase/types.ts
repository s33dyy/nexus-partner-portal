export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      partner_documents: {
        Row: {
          created_at: string;
          doc_type: string;
          file_name: string;
          file_path: string;
          id: string;
          mime_type: string | null;
          partner_id: string;
          size_bytes: number | null;
          uploaded_by: string;
        };
        Insert: {
          created_at?: string;
          doc_type: string;
          file_name: string;
          file_path: string;
          id?: string;
          mime_type?: string | null;
          partner_id: string;
          size_bytes?: number | null;
          uploaded_by: string;
        };
        Update: {
          created_at?: string;
          doc_type?: string;
          file_name?: string;
          file_path?: string;
          id?: string;
          mime_type?: string | null;
          partner_id?: string;
          size_bytes?: number | null;
          uploaded_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "partner_documents_partner_id_fkey";
            columns: ["partner_id"];
            isOneToOne: false;
            referencedRelation: "partners";
            referencedColumns: ["id"];
          },
        ];
      };
      partner_review_notes: {
        Row: {
          author_id: string;
          created_at: string;
          id: string;
          note: string;
          partner_id: string;
          status_change: string | null;
        };
        Insert: {
          author_id: string;
          created_at?: string;
          id?: string;
          note: string;
          partner_id: string;
          status_change?: string | null;
        };
        Update: {
          author_id?: string;
          created_at?: string;
          id?: string;
          note?: string;
          partner_id?: string;
          status_change?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "partner_review_notes_partner_id_fkey";
            columns: ["partner_id"];
            isOneToOne: false;
            referencedRelation: "partners";
            referencedColumns: ["id"];
          },
        ];
      };
      portal_demo_feed_items: {
        Row: {
          body: string;
          created_at: string;
          id: string;
          is_seed: boolean;
          sort_order: number;
          time_label: string;
          title: string;
          tone: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          id?: string;
          is_seed?: boolean;
          sort_order?: number;
          time_label: string;
          title: string;
          tone?: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          id?: string;
          is_seed?: boolean;
          sort_order?: number;
          time_label?: string;
          title?: string;
          tone?: string;
        };
        Relationships: [];
      };
      portal_demo_metrics: {
        Row: {
          created_at: string;
          hint: string;
          id: string;
          is_seed: boolean;
          label: string;
          sort_order: number;
          tone: string;
          value: string;
        };
        Insert: {
          created_at?: string;
          hint: string;
          id?: string;
          is_seed?: boolean;
          label: string;
          sort_order?: number;
          tone?: string;
          value: string;
        };
        Update: {
          created_at?: string;
          hint?: string;
          id?: string;
          is_seed?: boolean;
          label?: string;
          sort_order?: number;
          tone?: string;
          value?: string;
        };
        Relationships: [];
      };
      portal_demo_partner_spotlights: {
        Row: {
          company_name: string;
          contact_name: string;
          created_at: string;
          id: string;
          is_seed: boolean;
          last_activity: string;
          pipeline_value: string;
          region: string;
          sort_order: number;
          status: string;
          tier: string;
        };
        Insert: {
          company_name: string;
          contact_name: string;
          created_at?: string;
          id?: string;
          is_seed?: boolean;
          last_activity: string;
          pipeline_value: string;
          region: string;
          sort_order?: number;
          status: string;
          tier: string;
        };
        Update: {
          company_name?: string;
          contact_name?: string;
          created_at?: string;
          id?: string;
          is_seed?: boolean;
          last_activity?: string;
          pipeline_value?: string;
          region?: string;
          sort_order?: number;
          status?: string;
          tier?: string;
        };
        Relationships: [];
      };
      partners: {
        Row: {
          annual_turnover: string | null;
          business_address: string | null;
          business_focus: string[] | null;
          business_type: string | null;
          cin: string | null;
          company_name: string;
          country: string | null;
          created_at: string;
          employee_count: string | null;
          gst_number: string | null;
          id: string;
          legal_name: string | null;
          owner_user_id: string;
          pan: string | null;
          state: string | null;
          status: Database["public"]["Enums"]["partner_status"];
          tier: Database["public"]["Enums"]["partner_tier"];
          updated_at: string;
          website: string | null;
          years_in_business: number | null;
        };
        Insert: {
          annual_turnover?: string | null;
          business_address?: string | null;
          business_focus?: string[] | null;
          business_type?: string | null;
          cin?: string | null;
          company_name: string;
          country?: string | null;
          created_at?: string;
          employee_count?: string | null;
          gst_number?: string | null;
          id?: string;
          legal_name?: string | null;
          owner_user_id: string;
          pan?: string | null;
          state?: string | null;
          status?: Database["public"]["Enums"]["partner_status"];
          tier?: Database["public"]["Enums"]["partner_tier"];
          updated_at?: string;
          website?: string | null;
          years_in_business?: number | null;
        };
        Update: {
          annual_turnover?: string | null;
          business_address?: string | null;
          business_focus?: string[] | null;
          business_type?: string | null;
          cin?: string | null;
          company_name?: string;
          country?: string | null;
          created_at?: string;
          employee_count?: string | null;
          gst_number?: string | null;
          id?: string;
          legal_name?: string | null;
          owner_user_id?: string;
          pan?: string | null;
          state?: string | null;
          status?: Database["public"]["Enums"]["partner_status"];
          tier?: Database["public"]["Enums"]["partner_tier"];
          updated_at?: string;
          website?: string | null;
          years_in_business?: number | null;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          company_name: string | null;
          created_at: string;
          email: string;
          full_name: string;
          id: string;
          partner_id: string | null;
          partner_status: Database["public"]["Enums"]["partner_status"];
          phone: string | null;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          company_name?: string | null;
          created_at?: string;
          email: string;
          full_name: string;
          id: string;
          partner_id?: string | null;
          partner_status?: Database["public"]["Enums"]["partner_status"];
          phone?: string | null;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          company_name?: string | null;
          created_at?: string;
          email?: string;
          full_name?: string;
          id?: string;
          partner_id?: string | null;
          partner_status?: Database["public"]["Enums"]["partner_status"];
          phone?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_partner_fk";
            columns: ["partner_id"];
            isOneToOne: false;
            referencedRelation: "partners";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
    };
    Enums: {
      app_role: "super_admin" | "partner_admin" | "partner_user";
      partner_status:
        | "pending_partner_registration"
        | "submitted"
        | "under_review"
        | "need_more_info"
        | "approved"
        | "rejected";
      partner_tier: "registered" | "silver" | "gold" | "platinum";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["super_admin", "partner_admin", "partner_user"],
      partner_status: [
        "pending_partner_registration",
        "submitted",
        "under_review",
        "need_more_info",
        "approved",
        "rejected",
      ],
      partner_tier: ["registered", "silver", "gold", "platinum"],
    },
  },
} as const;
