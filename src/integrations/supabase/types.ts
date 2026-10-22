export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      car_expenses: {
        Row: {
          amount: number
          car_id: string
          created_at: string
          description: string | null
          expense_date: string
          id: string
          is_demo: boolean
          title: string
        }
        Insert: {
          amount?: number
          car_id: string
          created_at?: string
          description?: string | null
          expense_date?: string
          id?: string
          is_demo?: boolean
          title: string
        }
        Update: {
          amount?: number
          car_id?: string
          created_at?: string
          description?: string | null
          expense_date?: string
          id?: string
          is_demo?: boolean
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "car_expenses_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
        ]
      }
      car_investments: {
        Row: {
          amount: number
          car_id: string
          created_at: string
          id: string
          is_demo: boolean
          partner_id: string
        }
        Insert: {
          amount: number
          car_id: string
          created_at?: string
          id?: string
          is_demo?: boolean
          partner_id: string
        }
        Update: {
          amount?: number
          car_id?: string
          created_at?: string
          id?: string
          is_demo?: boolean
          partner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "car_investments_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "car_investments_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      cars: {
        Row: {
          brand: string
          color: string | null
          created_at: string
          id: string
          is_demo: boolean
          model: string
          notes: string | null
          plate: string | null
          purchase_date: string
          purchase_price: number
          sale_date: string | null
          sale_price: number | null
          status: Database["public"]["Enums"]["car_status"]
          year: number | null
        }
        Insert: {
          brand: string
          color?: string | null
          created_at?: string
          id?: string
          is_demo?: boolean
          model: string
          notes?: string | null
          plate?: string | null
          purchase_date?: string
          purchase_price?: number
          sale_date?: string | null
          sale_price?: number | null
          status?: Database["public"]["Enums"]["car_status"]
          year?: number | null
        }
        Update: {
          brand?: string
          color?: string | null
          created_at?: string
          id?: string
          is_demo?: boolean
          model?: string
          notes?: string | null
          plate?: string | null
          purchase_date?: string
          purchase_price?: number
          sale_date?: string | null
          sale_price?: number | null
          status?: Database["public"]["Enums"]["car_status"]
          year?: number | null
        }
        Relationships: []
      }
      partners: {
        Row: {
          created_at: string
          email: string | null
          id: string
          is_demo: boolean
          name: string
          phone: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          is_demo?: boolean
          name: string
          phone?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          is_demo?: boolean
          name?: string
          phone?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount: number
          car_id: string | null
          created_at: string
          description: string | null
          id: string
          is_demo: boolean
          partner_id: string | null
          txn_date: string
          type: Database["public"]["Enums"]["txn_type"]
        }
        Insert: {
          amount: number
          car_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_demo?: boolean
          partner_id?: string | null
          txn_date?: string
          type: Database["public"]["Enums"]["txn_type"]
        }
        Update: {
          amount?: number
          car_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_demo?: boolean
          partner_id?: string | null
          txn_date?: string
          type?: Database["public"]["Enums"]["txn_type"]
        }
        Relationships: [
          {
            foreignKeyName: "transactions_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      my_car_shares: {
        Args: never
        Returns: {
          car_id: string
          my_investment: number
          total_investment: number
        }[]
      }
      my_partner_ids: { Args: never; Returns: string[] }
    }
    Enums: {
      app_role: "admin" | "partner"
      car_status: "available" | "reserved" | "sold"
      txn_type: "receipt" | "payment" | "expense" | "settlement"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "partner"],
      car_status: ["available", "reserved", "sold"],
      txn_type: ["receipt", "payment", "expense", "settlement"],
    },
  },
} as const
