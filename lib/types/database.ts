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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      attendance: {
        Row: {
          attended_on: string
          branch_id: string
          checked_in_at: string
          checked_in_by: string | null
          checked_out_at: string | null
          created_at: string
          days_to_expiry_at_checkin: number | null
          due_paisa_at_checkin: number
          id: string
          is_override: boolean
          member_id: string
          membership_id: string | null
          membership_status_at_checkin:
            | Database["public"]["Enums"]["membership_status"]
            | null
          method: Database["public"]["Enums"]["attendance_method"]
          notes: string | null
          org_id: string
          override_reason: string | null
          updated_at: string
        }
        Insert: {
          attended_on: string
          branch_id: string
          checked_in_at?: string
          checked_in_by?: string | null
          checked_out_at?: string | null
          created_at?: string
          days_to_expiry_at_checkin?: number | null
          due_paisa_at_checkin?: number
          id?: string
          is_override?: boolean
          member_id: string
          membership_id?: string | null
          membership_status_at_checkin?:
            | Database["public"]["Enums"]["membership_status"]
            | null
          method?: Database["public"]["Enums"]["attendance_method"]
          notes?: string | null
          org_id: string
          override_reason?: string | null
          updated_at?: string
        }
        Update: {
          attended_on?: string
          branch_id?: string
          checked_in_at?: string
          checked_in_by?: string | null
          checked_out_at?: string | null
          created_at?: string
          days_to_expiry_at_checkin?: number | null
          due_paisa_at_checkin?: number
          id?: string
          is_override?: boolean
          member_id?: string
          membership_id?: string | null
          membership_status_at_checkin?:
            | Database["public"]["Enums"]["membership_status"]
            | null
          method?: Database["public"]["Enums"]["attendance_method"]
          notes?: string | null
          org_id?: string
          override_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_branch_fkey"
            columns: ["branch_id", "org_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "attendance_checked_in_by_fkey"
            columns: ["checked_in_by", "org_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "attendance_member_fkey"
            columns: ["member_id", "org_id"]
            isOneToOne: false
            referencedRelation: "member_overview"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "attendance_member_fkey"
            columns: ["member_id", "org_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "attendance_membership_fkey"
            columns: ["membership_id", "org_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "attendance_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_auth_user_id: string | null
          actor_staff_id: string | null
          after: Json | null
          before: Json | null
          branch_id: string | null
          created_at: string
          entity: string
          entity_id: string | null
          id: number
          org_id: string
        }
        Insert: {
          action: string
          actor_auth_user_id?: string | null
          actor_staff_id?: string | null
          after?: Json | null
          before?: Json | null
          branch_id?: string | null
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: never
          org_id: string
        }
        Update: {
          action?: string
          actor_auth_user_id?: string | null
          actor_staff_id?: string | null
          after?: Json | null
          before?: Json | null
          branch_id?: string | null
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: never
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          address: string | null
          closes_at: string | null
          created_at: string
          id: string
          name: string
          opens_at: string | null
          org_id: string
          phone: string | null
          settings: Json
          status: Database["public"]["Enums"]["branch_status"]
          updated_at: string
        }
        Insert: {
          address?: string | null
          closes_at?: string | null
          created_at?: string
          id?: string
          name: string
          opens_at?: string | null
          org_id: string
          phone?: string | null
          settings?: Json
          status?: Database["public"]["Enums"]["branch_status"]
          updated_at?: string
        }
        Update: {
          address?: string | null
          closes_at?: string | null
          created_at?: string
          id?: string
          name?: string
          opens_at?: string | null
          org_id?: string
          phone?: string | null
          settings?: Json
          status?: Database["public"]["Enums"]["branch_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branches_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      device_tokens: {
        Row: {
          app_version: string | null
          created_at: string
          id: string
          last_seen_at: string
          member_id: string | null
          org_id: string
          platform: Database["public"]["Enums"]["device_platform"]
          revoked_at: string | null
          staff_id: string | null
          token: string
          updated_at: string
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          id?: string
          last_seen_at?: string
          member_id?: string | null
          org_id: string
          platform: Database["public"]["Enums"]["device_platform"]
          revoked_at?: string | null
          staff_id?: string | null
          token: string
          updated_at?: string
        }
        Update: {
          app_version?: string | null
          created_at?: string
          id?: string
          last_seen_at?: string
          member_id?: string | null
          org_id?: string
          platform?: Database["public"]["Enums"]["device_platform"]
          revoked_at?: string | null
          staff_id?: string | null
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_tokens_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "member_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_tokens_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_tokens_member_id_org_id_fkey"
            columns: ["member_id", "org_id"]
            isOneToOne: false
            referencedRelation: "member_overview"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "device_tokens_member_id_org_id_fkey"
            columns: ["member_id", "org_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "device_tokens_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_tokens_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_tokens_staff_id_org_id_fkey"
            columns: ["staff_id", "org_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      invoices: {
        Row: {
          branch_id: string
          created_at: string
          discount_paisa: number
          due_paisa: number | null
          id: string
          invoice_no: string
          issued_on: string
          member_id: string
          membership_id: string | null
          notes: string | null
          org_id: string
          paid_paisa: number
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal_paisa: number
          total_paisa: number
          updated_at: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          discount_paisa?: number
          due_paisa?: number | null
          id?: string
          invoice_no?: string
          issued_on?: string
          member_id: string
          membership_id?: string | null
          notes?: string | null
          org_id: string
          paid_paisa?: number
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal_paisa: number
          total_paisa: number
          updated_at?: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          discount_paisa?: number
          due_paisa?: number | null
          id?: string
          invoice_no?: string
          issued_on?: string
          member_id?: string
          membership_id?: string | null
          notes?: string | null
          org_id?: string
          paid_paisa?: number
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal_paisa?: number
          total_paisa?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_branch_fkey"
            columns: ["branch_id", "org_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "invoices_member_fkey"
            columns: ["member_id", "org_id"]
            isOneToOne: false
            referencedRelation: "member_overview"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "invoices_member_fkey"
            columns: ["member_id", "org_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "invoices_membership_fkey"
            columns: ["membership_id", "org_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "invoices_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          accepted_at: string | null
          address: string | null
          auth_user_id: string | null
          created_at: string
          created_by: string | null
          date_of_birth: string | null
          email: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          full_name: string
          gender: Database["public"]["Enums"]["member_gender"] | null
          home_branch_id: string
          id: string
          invited_at: string | null
          invited_by: string | null
          joined_on: string
          left_on: string | null
          left_reason: string | null
          member_code: string
          notes: string | null
          org_id: string
          phone: string
          photo_path: string | null
          status: Database["public"]["Enums"]["member_status"]
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          address?: string | null
          auth_user_id?: string | null
          created_at?: string
          created_by?: string | null
          date_of_birth?: string | null
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          full_name: string
          gender?: Database["public"]["Enums"]["member_gender"] | null
          home_branch_id: string
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          joined_on?: string
          left_on?: string | null
          left_reason?: string | null
          member_code?: string
          notes?: string | null
          org_id: string
          phone: string
          photo_path?: string | null
          status?: Database["public"]["Enums"]["member_status"]
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          address?: string | null
          auth_user_id?: string | null
          created_at?: string
          created_by?: string | null
          date_of_birth?: string | null
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          full_name?: string
          gender?: Database["public"]["Enums"]["member_gender"] | null
          home_branch_id?: string
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          joined_on?: string
          left_on?: string | null
          left_reason?: string | null
          member_code?: string
          notes?: string | null
          org_id?: string
          phone?: string
          photo_path?: string | null
          status?: Database["public"]["Enums"]["member_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "members_created_by_fkey"
            columns: ["created_by", "org_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "members_home_branch_fkey"
            columns: ["home_branch_id", "org_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "members_invited_by_fkey"
            columns: ["invited_by", "org_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_plans: {
        Row: {
          branch_ids: string[]
          created_at: string
          description: string | null
          duration_days: number | null
          id: string
          is_active: boolean
          name: string
          org_id: string
          plan_type: Database["public"]["Enums"]["plan_type"]
          price_paisa: number
          session_count: number | null
          signup_fee_paisa: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          branch_ids?: string[]
          created_at?: string
          description?: string | null
          duration_days?: number | null
          id?: string
          is_active?: boolean
          name: string
          org_id: string
          plan_type: Database["public"]["Enums"]["plan_type"]
          price_paisa: number
          session_count?: number | null
          signup_fee_paisa?: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          branch_ids?: string[]
          created_at?: string
          description?: string | null
          duration_days?: number | null
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          plan_type?: Database["public"]["Enums"]["plan_type"]
          price_paisa?: number
          session_count?: number | null
          signup_fee_paisa?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_plans_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          branch_id: string
          cancel_reason: string | null
          cancelled_at: string | null
          created_at: string
          discount_paisa: number
          end_date: string | null
          frozen_days: number
          frozen_on: string | null
          id: string
          member_id: string
          notes: string | null
          org_id: string
          plan_id: string
          plan_name: string
          plan_type: Database["public"]["Enums"]["plan_type"]
          previous_membership_id: string | null
          price_paisa: number
          sessions_remaining: number | null
          sessions_total: number | null
          sold_by: string | null
          start_date: string
          status: Database["public"]["Enums"]["membership_status"]
          updated_at: string
        }
        Insert: {
          branch_id: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          discount_paisa?: number
          end_date?: string | null
          frozen_days?: number
          frozen_on?: string | null
          id?: string
          member_id: string
          notes?: string | null
          org_id: string
          plan_id: string
          plan_name: string
          plan_type: Database["public"]["Enums"]["plan_type"]
          previous_membership_id?: string | null
          price_paisa: number
          sessions_remaining?: number | null
          sessions_total?: number | null
          sold_by?: string | null
          start_date: string
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
        }
        Update: {
          branch_id?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          discount_paisa?: number
          end_date?: string | null
          frozen_days?: number
          frozen_on?: string | null
          id?: string
          member_id?: string
          notes?: string | null
          org_id?: string
          plan_id?: string
          plan_name?: string
          plan_type?: Database["public"]["Enums"]["plan_type"]
          previous_membership_id?: string | null
          price_paisa?: number
          sessions_remaining?: number | null
          sessions_total?: number | null
          sold_by?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_branch_fkey"
            columns: ["branch_id", "org_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "memberships_member_fkey"
            columns: ["member_id", "org_id"]
            isOneToOne: false
            referencedRelation: "member_overview"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "memberships_member_fkey"
            columns: ["member_id", "org_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "memberships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_plan_fkey"
            columns: ["plan_id", "org_id"]
            isOneToOne: false
            referencedRelation: "membership_plans"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "memberships_previous_membership_id_fkey"
            columns: ["previous_membership_id"]
            isOneToOne: false
            referencedRelation: "member_overview"
            referencedColumns: ["current_membership_id"]
          },
          {
            foreignKeyName: "memberships_previous_membership_id_fkey"
            columns: ["previous_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_sold_by_fkey"
            columns: ["sold_by", "org_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      org_counters: {
        Row: {
          invoice_seq: number
          member_seq: number
          org_id: string
        }
        Insert: {
          invoice_seq?: number
          member_seq?: number
          org_id: string
        }
        Update: {
          invoice_seq?: number
          member_seq?: number
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_counters_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      orgs: {
        Row: {
          created_at: string
          currency: string
          id: string
          max_branches: number
          name: string
          settings: Json
          slug: string
          status: Database["public"]["Enums"]["org_status"]
          subscription_tier: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          max_branches?: number
          name: string
          settings?: Json
          slug: string
          status?: Database["public"]["Enums"]["org_status"]
          subscription_tier?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          max_branches?: number
          name?: string
          settings?: Json
          slug?: string
          status?: Database["public"]["Enums"]["org_status"]
          subscription_tier?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount_paisa: number
          branch_id: string
          collected_by: string | null
          created_at: string
          id: string
          invoice_id: string | null
          kind: Database["public"]["Enums"]["payment_kind"]
          member_id: string
          membership_id: string | null
          method: Database["public"]["Enums"]["payment_method"]
          notes: string | null
          org_id: string
          paid_at: string
          reason: string | null
          reference_no: string | null
        }
        Insert: {
          amount_paisa: number
          branch_id: string
          collected_by?: string | null
          created_at?: string
          id?: string
          invoice_id?: string | null
          kind?: Database["public"]["Enums"]["payment_kind"]
          member_id: string
          membership_id?: string | null
          method: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          org_id: string
          paid_at?: string
          reason?: string | null
          reference_no?: string | null
        }
        Update: {
          amount_paisa?: number
          branch_id?: string
          collected_by?: string | null
          created_at?: string
          id?: string
          invoice_id?: string | null
          kind?: Database["public"]["Enums"]["payment_kind"]
          member_id?: string
          membership_id?: string | null
          method?: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          org_id?: string
          paid_at?: string
          reason?: string | null
          reference_no?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_branch_fkey"
            columns: ["branch_id", "org_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "payments_collected_by_fkey"
            columns: ["collected_by", "org_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "payments_invoice_fkey"
            columns: ["invoice_id", "org_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "payments_member_fkey"
            columns: ["member_id", "org_id"]
            isOneToOne: false
            referencedRelation: "member_overview"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "payments_member_fkey"
            columns: ["member_id", "org_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "payments_membership_fkey"
            columns: ["membership_id", "org_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "payments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      push_log: {
        Row: {
          created_at: string
          device_token_id: string | null
          error: string | null
          id: string
          member_id: string | null
          org_id: string
          status: string
          title: string
        }
        Insert: {
          created_at?: string
          device_token_id?: string | null
          error?: string | null
          id?: string
          member_id?: string | null
          org_id: string
          status: string
          title: string
        }
        Update: {
          created_at?: string
          device_token_id?: string | null
          error?: string | null
          id?: string
          member_id?: string | null
          org_id?: string
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_log_device_token_id_fkey"
            columns: ["device_token_id"]
            isOneToOne: false
            referencedRelation: "device_tokens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_log_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "member_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_log_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_log_member_id_org_id_fkey"
            columns: ["member_id", "org_id"]
            isOneToOne: false
            referencedRelation: "member_overview"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "push_log_member_id_org_id_fkey"
            columns: ["member_id", "org_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "push_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          accepted_at: string | null
          auth_user_id: string | null
          branch_ids: string[]
          created_at: string
          email: string
          full_name: string
          id: string
          invited_at: string
          invited_by: string | null
          org_id: string
          phone: string | null
          role: Database["public"]["Enums"]["staff_role"]
          status: Database["public"]["Enums"]["staff_status"]
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          auth_user_id?: string | null
          branch_ids?: string[]
          created_at?: string
          email: string
          full_name: string
          id?: string
          invited_at?: string
          invited_by?: string | null
          org_id: string
          phone?: string | null
          role: Database["public"]["Enums"]["staff_role"]
          status?: Database["public"]["Enums"]["staff_status"]
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          auth_user_id?: string | null
          branch_ids?: string[]
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          invited_at?: string
          invited_by?: string | null
          org_id?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["staff_role"]
          status?: Database["public"]["Enums"]["staff_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      attendance_detail: {
        Row: {
          attended_on: string | null
          branch_id: string | null
          branch_name: string | null
          checked_in_at: string | null
          checked_in_by: string | null
          checked_in_by_name: string | null
          checked_out_at: string | null
          days_to_expiry_at_checkin: number | null
          due_paisa_at_checkin: number | null
          full_name: string | null
          id: string | null
          is_override: boolean | null
          member_code: string | null
          member_id: string | null
          membership_id: string | null
          membership_status_at_checkin:
            | Database["public"]["Enums"]["membership_status"]
            | null
          method: Database["public"]["Enums"]["attendance_method"] | null
          notes: string | null
          org_id: string | null
          override_reason: string | null
          phone: string | null
          photo_path: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_branch_fkey"
            columns: ["branch_id", "org_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "attendance_checked_in_by_fkey"
            columns: ["checked_in_by", "org_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "attendance_member_fkey"
            columns: ["member_id", "org_id"]
            isOneToOne: false
            referencedRelation: "member_overview"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "attendance_member_fkey"
            columns: ["member_id", "org_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "attendance_membership_fkey"
            columns: ["membership_id", "org_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "attendance_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      member_overview: {
        Row: {
          current_membership_id: string | null
          current_plan_id: string | null
          current_plan_name: string | null
          current_plan_type: Database["public"]["Enums"]["plan_type"] | null
          days_to_expiry: number | null
          due_paisa: number | null
          email: string | null
          full_name: string | null
          home_branch_id: string | null
          home_branch_name: string | null
          id: string | null
          joined_on: string | null
          left_on: string | null
          member_code: string | null
          membership_end_date: string | null
          membership_start_date: string | null
          membership_status:
            | Database["public"]["Enums"]["membership_status"]
            | null
          oldest_due_on: string | null
          org_id: string | null
          phone: string | null
          photo_path: string | null
          sessions_remaining: number | null
          status: Database["public"]["Enums"]["member_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "members_home_branch_fkey"
            columns: ["home_branch_id", "org_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      absent_members: {
        Args: { p_branch_id?: string; p_min_days?: number }
        Returns: {
          band: string
          days_absent: number
          days_to_expiry: number
          due_paisa: number
          ever_visited: boolean
          full_name: string
          home_branch_id: string
          home_branch_name: string
          last_seen_on: string
          member_code: string
          member_id: string
          membership_end_date: string
          phone: string
        }[]
      }
      arrears_report: {
        Args: { p_branch_id?: string }
        Returns: {
          age_days: number
          bucket: string
          due_paisa: number
          full_name: string
          home_branch_id: string
          home_branch_name: string
          member_code: string
          member_id: string
          oldest_due_on: string
          phone: string
        }[]
      }
      attendance_banner: {
        Args: {
          p_days_to_expiry: number
          p_member_status: Database["public"]["Enums"]["member_status"]
          p_membership_status: Database["public"]["Enums"]["membership_status"]
          p_sessions_remaining: number
        }
        Returns: string
      }
      attendance_day_summary: {
        Args: { p_branch_id?: string; p_on?: string }
        Returns: {
          attended_on: string
          branch_id: string
          branch_name: string
          check_ins: number
          distinct_members: number
          in_gym_now: number
        }[]
      }
      cancel_membership: {
        Args: { p_membership_id: string; p_reason: string }
        Returns: Json
      }
      check_in_member: {
        Args: {
          p_branch_id: string
          p_member_id: string
          p_method?: Database["public"]["Enums"]["attendance_method"]
          p_notes?: string
          p_override?: boolean
          p_override_reason?: string
        }
        Returns: Json
      }
      check_out_member: { Args: { p_attendance_id: string }; Returns: Json }
      create_org_with_owner: {
        Args: {
          p_branch_name: string
          p_org_name: string
          p_owner_name: string
        }
        Returns: string
      }
      current_member: {
        Args: never
        Returns: {
          currency: string
          email: string
          full_name: string
          home_branch_id: string
          home_branch_name: string
          member_code: string
          member_id: string
          org_id: string
          org_name: string
          phone: string
          status: Database["public"]["Enums"]["member_status"]
          timezone: string
        }[]
      }
      current_staff: {
        Args: never
        Returns: {
          branch_ids: string[]
          email: string
          full_name: string
          org_id: string
          org_name: string
          role: Database["public"]["Enums"]["staff_role"]
          staff_id: string
        }[]
      }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      daily_collection: {
        Args: { p_branch_id?: string; p_on?: string }
        Returns: {
          amount_paisa: number
          branch_id: string
          branch_name: string
          kind: Database["public"]["Enums"]["payment_kind"]
          method: Database["public"]["Enums"]["payment_method"]
          staff_id: string
          staff_name: string
          txn_count: number
        }[]
      }
      freeze_membership: {
        Args: { p_membership_id: string; p_notes?: string }
        Returns: Json
      }
      has_branch_access: {
        Args: { target_branch_id: string }
        Returns: boolean
      }
      in_gym_now: {
        Args: { p_branch_id?: string }
        Returns: {
          attendance_id: string
          branch_id: string
          branch_name: string
          checked_in_at: string
          days_to_expiry: number
          due_paisa: number
          full_name: string
          member_code: string
          member_id: string
          membership_status: Database["public"]["Enums"]["membership_status"]
          minutes_in: number
          phone: string
          photo_path: string
        }[]
      }
      invite_member: {
        Args: { p_email: string; p_member_id: string }
        Returns: string
      }
      is_org_member: { Args: { target_org_id: string }; Returns: boolean }
      jwt_branch_ids: { Args: never; Returns: string[] }
      jwt_can_serve_members: { Args: never; Returns: boolean }
      jwt_claims: { Args: never; Returns: Json }
      jwt_is_member: { Args: never; Returns: boolean }
      jwt_is_owner: { Args: never; Returns: boolean }
      jwt_is_staff: { Args: never; Returns: boolean }
      jwt_member_id: { Args: never; Returns: string }
      jwt_org_id: { Args: never; Returns: string }
      jwt_staff_id: { Args: never; Returns: string }
      jwt_staff_role: {
        Args: never
        Returns: Database["public"]["Enums"]["staff_role"]
      }
      link_member_account: { Args: never; Returns: string }
      link_staff_account: { Args: never; Returns: string }
      member_computed_status: {
        Args: { p_left_on: string; p_member_id: string }
        Returns: Database["public"]["Enums"]["member_status"]
      }
      mint_qr_token: {
        Args: { p_member_id?: string; p_ttl_seconds?: number }
        Returns: Json
      }
      next_org_counter: {
        Args: { p_counter: string; p_org_id: string }
        Returns: number
      }
      org_today: { Args: { p_org_id: string }; Returns: string }
      plan_sold_at: {
        Args: { p_branch_id: string; p_plan_id: string }
        Returns: boolean
      }
      qr_sign: { Args: { p_key: string; p_payload: string }; Returns: string }
      qr_signing_key: { Args: never; Returns: string }
      reactivate_member: { Args: { p_member_id: string }; Returns: Json }
      record_payment: {
        Args: {
          p_amount_paisa: number
          p_invoice_id: string
          p_method?: Database["public"]["Enums"]["payment_method"]
          p_notes?: string
          p_reference_no?: string
        }
        Returns: Json
      }
      refund_payment: {
        Args: {
          p_amount_paisa: number
          p_method?: Database["public"]["Enums"]["payment_method"]
          p_payment_id: string
          p_reason: string
          p_reference_no?: string
        }
        Returns: Json
      }
      register_device_token: {
        Args: { p_app_version?: string; p_platform: string; p_token: string }
        Returns: string
      }
      renew_membership: {
        Args: {
          p_amount_paid_paisa?: number
          p_branch_id: string
          p_discount_paisa?: number
          p_member_id: string
          p_method?: Database["public"]["Enums"]["payment_method"]
          p_notes?: string
          p_plan_id: string
          p_reference_no?: string
          p_start_date?: string
        }
        Returns: Json
      }
      revoke_device_token: { Args: { p_token: string }; Returns: undefined }
      set_member_left: {
        Args: { p_left_on?: string; p_member_id: string; p_reason?: string }
        Returns: Json
      }
      storage_object_org: { Args: { object_name: string }; Returns: string }
      sweep_membership_expiry: {
        Args: never
        Returns: {
          expired: number
          members_touched: number
          started: number
        }[]
      }
      unfreeze_membership: { Args: { p_membership_id: string }; Returns: Json }
      verify_qr_token: { Args: { p_token: string }; Returns: Json }
    }
    Enums: {
      attendance_method: "manual" | "qr" | "card" | "biometric"
      branch_status: "active" | "inactive"
      device_platform: "ios" | "android"
      invoice_status: "unpaid" | "partial" | "paid" | "void"
      member_gender: "male" | "female" | "other"
      member_status: "active" | "expired" | "frozen" | "left"
      membership_status:
        | "upcoming"
        | "active"
        | "frozen"
        | "expired"
        | "cancelled"
      org_status: "active" | "suspended" | "cancelled"
      payment_kind: "payment" | "refund"
      payment_method: "cash" | "esewa" | "khalti" | "fonepay" | "bank" | "card"
      plan_type: "time" | "session_pack"
      staff_role: "owner" | "manager" | "front_desk" | "trainer"
      staff_status: "invited" | "active" | "inactive"
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
      attendance_method: ["manual", "qr", "card", "biometric"],
      branch_status: ["active", "inactive"],
      device_platform: ["ios", "android"],
      invoice_status: ["unpaid", "partial", "paid", "void"],
      member_gender: ["male", "female", "other"],
      member_status: ["active", "expired", "frozen", "left"],
      membership_status: [
        "upcoming",
        "active",
        "frozen",
        "expired",
        "cancelled",
      ],
      org_status: ["active", "suspended", "cancelled"],
      payment_kind: ["payment", "refund"],
      payment_method: ["cash", "esewa", "khalti", "fonepay", "bank", "card"],
      plan_type: ["time", "session_pack"],
      staff_role: ["owner", "manager", "front_desk", "trainer"],
      staff_status: ["invited", "active", "inactive"],
    },
  },
} as const
