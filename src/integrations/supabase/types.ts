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
      admin_action_logs: {
        Row: {
          action: string
          admin_user_id: string
          created_at: string
          id: string
          new_values: Json | null
          previous_values: Json | null
          reason: string | null
          target_agent_id: string | null
        }
        Insert: {
          action: string
          admin_user_id: string
          created_at?: string
          id?: string
          new_values?: Json | null
          previous_values?: Json | null
          reason?: string | null
          target_agent_id?: string | null
        }
        Update: {
          action?: string
          admin_user_id?: string
          created_at?: string
          id?: string
          new_values?: Json | null
          previous_values?: Json | null
          reason?: string | null
          target_agent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_action_logs_target_agent_id_fkey"
            columns: ["target_agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "admin_action_logs_target_agent_id_fkey"
            columns: ["target_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_activity_logs: {
        Row: {
          action: string
          agent_id: string | null
          created_at: string
          id: string
          metadata: Json
          resource_id: string | null
          resource_type: string | null
        }
        Insert: {
          action: string
          agent_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          resource_id?: string | null
          resource_type?: string | null
        }
        Update: {
          action?: string
          agent_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          resource_id?: string | null
          resource_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_activity_logs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "agent_activity_logs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_api_keys: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          revoked_at: string | null
          revoked_reason: string | null
        }
        Insert: {
          agent_id: string
          created_at?: string
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          revoked_at?: string | null
          revoked_reason?: string | null
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          revoked_at?: string | null
          revoked_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_api_keys_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "agent_api_keys_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_conversations: {
        Row: {
          agent_id: string
          agent_unread: boolean
          contact_shared_at: string | null
          created_at: string
          guest_access_hash: string
          guest_alias: string
          hiring_reviewed_at: string | null
          id: string
          intent: Database["public"]["Enums"]["conversation_intent"]
          last_message_at: string
          owner_attention_at: string | null
          status: Database["public"]["Enums"]["conversation_status"]
          updated_at: string
        }
        Insert: {
          agent_id: string
          agent_unread?: boolean
          contact_shared_at?: string | null
          created_at?: string
          guest_access_hash: string
          guest_alias: string
          hiring_reviewed_at?: string | null
          id?: string
          intent: Database["public"]["Enums"]["conversation_intent"]
          last_message_at?: string
          owner_attention_at?: string | null
          status?: Database["public"]["Enums"]["conversation_status"]
          updated_at?: string
        }
        Update: {
          agent_id?: string
          agent_unread?: boolean
          contact_shared_at?: string | null
          created_at?: string
          guest_access_hash?: string
          guest_alias?: string
          hiring_reviewed_at?: string | null
          id?: string
          intent?: Database["public"]["Enums"]["conversation_intent"]
          last_message_at?: string
          owner_attention_at?: string | null
          status?: Database["public"]["Enums"]["conversation_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_conversations_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "agent_conversations_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_owner_settings: {
        Row: {
          agent_id: string
          allow_agent_contact_sharing: boolean
          contact_type: string | null
          contact_value: string | null
          updated_at: string
        }
        Insert: {
          agent_id: string
          allow_agent_contact_sharing?: boolean
          contact_type?: string | null
          contact_value?: string | null
          updated_at?: string
        }
        Update: {
          agent_id?: string
          allow_agent_contact_sharing?: boolean
          contact_type?: string | null
          contact_value?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_owner_settings_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "agent_owner_settings_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_payout_wallets: {
        Row: {
          agent_id: string
          created_at: string
          created_by: string | null
          created_by_type: string
          id: string
          is_current: boolean
          last_action_reason: string | null
          last_actor_id: string | null
          last_actor_type: string
          revoked_at: string | null
          status: string
          updated_at: string
          verification_method: string
          verified_at: string | null
          wallet_address: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          created_by?: string | null
          created_by_type: string
          id?: string
          is_current?: boolean
          last_action_reason?: string | null
          last_actor_id?: string | null
          last_actor_type: string
          revoked_at?: string | null
          status: string
          updated_at?: string
          verification_method: string
          verified_at?: string | null
          wallet_address: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          created_by?: string | null
          created_by_type?: string
          id?: string
          is_current?: boolean
          last_action_reason?: string | null
          last_actor_id?: string | null
          last_actor_type?: string
          revoked_at?: string | null
          status?: string
          updated_at?: string
          verification_method?: string
          verified_at?: string | null
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_payout_wallets_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "agent_payout_wallets_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_registration_receipts: {
        Row: {
          agent_id: string | null
          created_at: string
          expires_at: string
          id: string
          idempotency_key_hash: string
          response_payload: Json | null
          status: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          idempotency_key_hash: string
          response_payload?: Json | null
          status?: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          idempotency_key_hash?: string
          response_payload?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_registration_receipts_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "agent_registration_receipts_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_reward_profiles: {
        Row: {
          admin_notes: string | null
          agent_id: string
          created_at: string
          monetary_enabled: boolean
          reward_mode: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          admin_notes?: string | null
          agent_id: string
          created_at?: string
          monetary_enabled?: boolean
          reward_mode?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          admin_notes?: string | null
          agent_id?: string
          created_at?: string
          monetary_enabled?: boolean
          reward_mode?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_reward_profiles_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "agent_reward_profiles_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          anonymous_chat_enabled: boolean
          available_for_work: boolean
          avatar_config: Json | null
          avatar_seed: string | null
          avatar_url: string | null
          avatar_version: number
          bio: string | null
          can_comment: boolean
          can_create_visual_posts: boolean
          can_follow: boolean
          can_post: boolean
          can_react: boolean
          can_receive_work_requests: boolean
          capabilities: string[]
          created_at: string
          demo_persona_key: string | null
          framework: string | null
          id: string
          is_demo: boolean
          languages: string[]
          last_active_at: string | null
          model_provider: string | null
          name: string
          owner_claimed: boolean
          owner_claimed_at: string | null
          owner_contacts: Json | null
          owner_name: string | null
          platform: string
          presence: string
          reputation: number
          restriction_reason: string | null
          role: string
          status: Database["public"]["Enums"]["agent_status"]
          status_text: string | null
          suspended_at: string | null
          suspended_until: string | null
          suspension_reason: string | null
          updated_at: string
          username: string
          visual_posts_daily_limit: number | null
        }
        Insert: {
          anonymous_chat_enabled?: boolean
          available_for_work?: boolean
          avatar_config?: Json | null
          avatar_seed?: string | null
          avatar_url?: string | null
          avatar_version?: number
          bio?: string | null
          can_comment?: boolean
          can_create_visual_posts?: boolean
          can_follow?: boolean
          can_post?: boolean
          can_react?: boolean
          can_receive_work_requests?: boolean
          capabilities?: string[]
          created_at?: string
          demo_persona_key?: string | null
          framework?: string | null
          id?: string
          is_demo?: boolean
          languages?: string[]
          last_active_at?: string | null
          model_provider?: string | null
          name: string
          owner_claimed?: boolean
          owner_claimed_at?: string | null
          owner_contacts?: Json | null
          owner_name?: string | null
          platform?: string
          presence?: string
          reputation?: number
          restriction_reason?: string | null
          role?: string
          status?: Database["public"]["Enums"]["agent_status"]
          status_text?: string | null
          suspended_at?: string | null
          suspended_until?: string | null
          suspension_reason?: string | null
          updated_at?: string
          username: string
          visual_posts_daily_limit?: number | null
        }
        Update: {
          anonymous_chat_enabled?: boolean
          available_for_work?: boolean
          avatar_config?: Json | null
          avatar_seed?: string | null
          avatar_url?: string | null
          avatar_version?: number
          bio?: string | null
          can_comment?: boolean
          can_create_visual_posts?: boolean
          can_follow?: boolean
          can_post?: boolean
          can_react?: boolean
          can_receive_work_requests?: boolean
          capabilities?: string[]
          created_at?: string
          demo_persona_key?: string | null
          framework?: string | null
          id?: string
          is_demo?: boolean
          languages?: string[]
          last_active_at?: string | null
          model_provider?: string | null
          name?: string
          owner_claimed?: boolean
          owner_claimed_at?: string | null
          owner_contacts?: Json | null
          owner_name?: string | null
          platform?: string
          presence?: string
          reputation?: number
          restriction_reason?: string | null
          role?: string
          status?: Database["public"]["Enums"]["agent_status"]
          status_text?: string | null
          suspended_at?: string | null
          suspended_until?: string | null
          suspension_reason?: string | null
          updated_at?: string
          username?: string
          visual_posts_daily_limit?: number | null
        }
        Relationships: []
      }
      anonymous_chat_settings: {
        Row: {
          global_enabled: boolean
          id: string
          updated_at: string
        }
        Insert: {
          global_enabled?: boolean
          id?: string
          updated_at?: string
        }
        Update: {
          global_enabled?: boolean
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      arena_settings: {
        Row: {
          created_at: string
          id: string
          min_liquidity_usd: number
          min_onchain_days: number
          min_paper_trades: number
          min_sol_resolved: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          min_liquidity_usd?: number
          min_onchain_days?: number
          min_paper_trades?: number
          min_sol_resolved?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          min_liquidity_usd?: number
          min_onchain_days?: number
          min_paper_trades?: number
          min_sol_resolved?: number
          updated_at?: string
        }
        Relationships: []
      }
      comments: {
        Row: {
          agent_id: string
          content: string
          created_at: string
          hidden_at: string | null
          hidden_by: string | null
          hidden_reason: string | null
          id: string
          post_id: string
        }
        Insert: {
          agent_id: string
          content: string
          created_at?: string
          hidden_at?: string | null
          hidden_by?: string | null
          hidden_reason?: string | null
          id?: string
          post_id: string
        }
        Update: {
          agent_id?: string
          content?: string
          created_at?: string
          hidden_at?: string | null
          hidden_by?: string | null
          hidden_reason?: string | null
          id?: string
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "comments_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_contacts: {
        Row: {
          consented_at: string
          contact_type: string
          contact_value: string
          conversation_id: string
          created_at: string
          id: string
        }
        Insert: {
          consented_at?: string
          contact_type: string
          contact_value: string
          conversation_id: string
          created_at?: string
          id?: string
        }
        Update: {
          consented_at?: string
          contact_type?: string
          contact_value?: string
          conversation_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_contacts_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "agent_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_messages: {
        Row: {
          client_message_id: string | null
          content: string
          conversation_id: string
          created_at: string
          id: string
          read_at: string | null
          sender_type: Database["public"]["Enums"]["conversation_sender"]
        }
        Insert: {
          client_message_id?: string | null
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_type: Database["public"]["Enums"]["conversation_sender"]
        }
        Update: {
          client_message_id?: string | null
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_type?: Database["public"]["Enums"]["conversation_sender"]
        }
        Relationships: [
          {
            foreignKeyName: "conversation_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "agent_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      demo_agent_configs: {
        Row: {
          agent_id: string
          cooldown_minutes: number
          created_at: string
          current_project: string
          enabled: boolean
          id: string
          last_run_at: string | null
          max_comments_per_day: number
          max_posts_per_day: number
          persona_key: string
          system_prompt: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          cooldown_minutes?: number
          created_at?: string
          current_project: string
          enabled?: boolean
          id?: string
          last_run_at?: string | null
          max_comments_per_day?: number
          max_posts_per_day?: number
          persona_key: string
          system_prompt: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          cooldown_minutes?: number
          created_at?: string
          current_project?: string
          enabled?: boolean
          id?: string
          last_run_at?: string | null
          max_comments_per_day?: number
          max_posts_per_day?: number
          persona_key?: string
          system_prompt?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "demo_agent_configs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "demo_agent_configs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      demo_agent_locks: {
        Row: {
          locked_by: string | null
          locked_until: string
          name: string
          updated_at: string
        }
        Insert: {
          locked_by?: string | null
          locked_until?: string
          name: string
          updated_at?: string
        }
        Update: {
          locked_by?: string | null
          locked_until?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      demo_agent_runs: {
        Row: {
          agent_id: string | null
          completed_at: string | null
          completion_tokens: number
          content_hash: string | null
          created_at: string
          created_comment_id: string | null
          created_post_id: string | null
          error_code: string | null
          error_message: string | null
          id: string
          internal_reason: string | null
          model: string | null
          prompt_tokens: number
          seed_key: string | null
          selected_action: string | null
          status: string
          target_comment_id: string | null
          target_post_id: string | null
          total_tokens: number
          trigger_type: string
        }
        Insert: {
          agent_id?: string | null
          completed_at?: string | null
          completion_tokens?: number
          content_hash?: string | null
          created_at?: string
          created_comment_id?: string | null
          created_post_id?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          internal_reason?: string | null
          model?: string | null
          prompt_tokens?: number
          seed_key?: string | null
          selected_action?: string | null
          status: string
          target_comment_id?: string | null
          target_post_id?: string | null
          total_tokens?: number
          trigger_type: string
        }
        Update: {
          agent_id?: string | null
          completed_at?: string | null
          completion_tokens?: number
          content_hash?: string | null
          created_at?: string
          created_comment_id?: string | null
          created_post_id?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          internal_reason?: string | null
          model?: string | null
          prompt_tokens?: number
          seed_key?: string | null
          selected_action?: string | null
          status?: string
          target_comment_id?: string | null
          target_post_id?: string | null
          total_tokens?: number
          trigger_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "demo_agent_runs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "demo_agent_runs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demo_agent_runs_created_comment_id_fkey"
            columns: ["created_comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demo_agent_runs_created_post_id_fkey"
            columns: ["created_post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demo_agent_runs_target_comment_id_fkey"
            columns: ["target_comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demo_agent_runs_target_post_id_fkey"
            columns: ["target_post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      demo_agent_settings: {
        Row: {
          created_at: string
          daily_max_comments: number
          daily_max_input_tokens: number
          daily_max_output_tokens: number
          daily_max_posts: number
          daily_max_requests: number
          global_enabled: boolean
          id: string
          max_thread_depth: number
          scheduler_enabled: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          daily_max_comments?: number
          daily_max_input_tokens?: number
          daily_max_output_tokens?: number
          daily_max_posts?: number
          daily_max_requests?: number
          global_enabled?: boolean
          id?: string
          max_thread_depth?: number
          scheduler_enabled?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          daily_max_comments?: number
          daily_max_input_tokens?: number
          daily_max_output_tokens?: number
          daily_max_posts?: number
          daily_max_requests?: number
          global_enabled?: boolean
          id?: string
          max_thread_depth?: number
          scheduler_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      demo_campaign_actions: {
        Row: {
          agent_id: string
          attempts: number
          campaign_id: string
          completed_at: string | null
          completion_tokens: number
          created_at: string
          created_comment_id: string | null
          created_post_id: string | null
          directive: string
          error_code: string | null
          error_message: string | null
          id: string
          kind: string
          model: string | null
          persona_key: string
          prompt_tokens: number
          published_as: string | null
          reply_to_step_key: string | null
          scheduled_at: string
          seq: number
          started_at: string | null
          status: string
          step_key: string
          target_comment_id: string | null
          target_post_id: string | null
          target_step_key: string | null
          updated_at: string
          visual_error: string | null
        }
        Insert: {
          agent_id: string
          attempts?: number
          campaign_id: string
          completed_at?: string | null
          completion_tokens?: number
          created_at?: string
          created_comment_id?: string | null
          created_post_id?: string | null
          directive: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          kind: string
          model?: string | null
          persona_key: string
          prompt_tokens?: number
          published_as?: string | null
          reply_to_step_key?: string | null
          scheduled_at: string
          seq: number
          started_at?: string | null
          status?: string
          step_key: string
          target_comment_id?: string | null
          target_post_id?: string | null
          target_step_key?: string | null
          updated_at?: string
          visual_error?: string | null
        }
        Update: {
          agent_id?: string
          attempts?: number
          campaign_id?: string
          completed_at?: string | null
          completion_tokens?: number
          created_at?: string
          created_comment_id?: string | null
          created_post_id?: string | null
          directive?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          kind?: string
          model?: string | null
          persona_key?: string
          prompt_tokens?: number
          published_as?: string | null
          reply_to_step_key?: string | null
          scheduled_at?: string
          seq?: number
          started_at?: string | null
          status?: string
          step_key?: string
          target_comment_id?: string | null
          target_post_id?: string | null
          target_step_key?: string | null
          updated_at?: string
          visual_error?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "demo_campaign_actions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "demo_campaign_actions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demo_campaign_actions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "demo_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      demo_campaigns: {
        Row: {
          campaign_key: string
          completed_at: string | null
          consecutive_errors: number
          created_at: string
          cron_job_name: string | null
          id: string
          locked_by: string | null
          locked_until: string | null
          max_comments: number
          max_posts: number
          max_requests: number
          requests_used: number
          started_at: string | null
          status: string
          stop_reason: string | null
          topic: string
          updated_at: string
        }
        Insert: {
          campaign_key: string
          completed_at?: string | null
          consecutive_errors?: number
          created_at?: string
          cron_job_name?: string | null
          id?: string
          locked_by?: string | null
          locked_until?: string | null
          max_comments: number
          max_posts: number
          max_requests: number
          requests_used?: number
          started_at?: string | null
          status?: string
          stop_reason?: string | null
          topic: string
          updated_at?: string
        }
        Update: {
          campaign_key?: string
          completed_at?: string | null
          consecutive_errors?: number
          created_at?: string
          cron_job_name?: string | null
          id?: string
          locked_by?: string | null
          locked_until?: string | null
          max_comments?: number
          max_posts?: number
          max_requests?: number
          requests_used?: number
          started_at?: string | null
          status?: string
          stop_reason?: string | null
          topic?: string
          updated_at?: string
        }
        Relationships: []
      }
      demo_scheduler_tokens: {
        Row: {
          created_at: string
          name: string
          token: string
        }
        Insert: {
          created_at?: string
          name: string
          token: string
        }
        Update: {
          created_at?: string
          name?: string
          token?: string
        }
        Relationships: []
      }
      follows: {
        Row: {
          created_at: string
          follower_agent_id: string
          following_agent_id: string
          id: string
        }
        Insert: {
          created_at?: string
          follower_agent_id: string
          following_agent_id: string
          id?: string
        }
        Update: {
          created_at?: string
          follower_agent_id?: string
          following_agent_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "follows_follower_agent_id_fkey"
            columns: ["follower_agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "follows_follower_agent_id_fkey"
            columns: ["follower_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follows_following_agent_id_fkey"
            columns: ["following_agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "follows_following_agent_id_fkey"
            columns: ["following_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      karma_events: {
        Row: {
          agent_id: string
          base_points: number
          content_fingerprint: string | null
          counterparty_agent_id: string | null
          created_at: string
          epoch_id: string
          event_type: string
          id: string
          idempotency_key: string
          invalidated_at: string | null
          invalidated_by: string | null
          invalidation_reason: string | null
          occurred_at: string
          points: number
          quality_multiplier_bps: number
          reject_reason: string | null
          rule_version: number
          source_id: string
          source_type: string
          status: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          base_points: number
          content_fingerprint?: string | null
          counterparty_agent_id?: string | null
          created_at?: string
          epoch_id: string
          event_type: string
          id?: string
          idempotency_key: string
          invalidated_at?: string | null
          invalidated_by?: string | null
          invalidation_reason?: string | null
          occurred_at: string
          points: number
          quality_multiplier_bps?: number
          reject_reason?: string | null
          rule_version?: number
          source_id: string
          source_type: string
          status?: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          base_points?: number
          content_fingerprint?: string | null
          counterparty_agent_id?: string | null
          created_at?: string
          epoch_id?: string
          event_type?: string
          id?: string
          idempotency_key?: string
          invalidated_at?: string | null
          invalidated_by?: string | null
          invalidation_reason?: string | null
          occurred_at?: string
          points?: number
          quality_multiplier_bps?: number
          reject_reason?: string | null
          rule_version?: number
          source_id?: string
          source_type?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "karma_events_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "karma_events_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "karma_events_counterparty_agent_id_fkey"
            columns: ["counterparty_agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "karma_events_counterparty_agent_id_fkey"
            columns: ["counterparty_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "karma_events_epoch_id_fkey"
            columns: ["epoch_id"]
            isOneToOne: false
            referencedRelation: "reward_epochs"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          agent_id: string
          body: string | null
          created_at: string
          id: string
          read_at: string | null
          resource_id: string | null
          resource_type: string | null
          title: string
          type: string
        }
        Insert: {
          agent_id: string
          body?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          resource_id?: string | null
          resource_type?: string | null
          title: string
          type: string
        }
        Update: {
          agent_id?: string
          body?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          resource_id?: string | null
          resource_type?: string | null
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "notifications_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_dashboard_links: {
        Row: {
          agent_id: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          token_hash: string
        }
        Insert: {
          agent_id: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          token_hash: string
        }
        Update: {
          agent_id?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "owner_dashboard_links_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "owner_dashboard_links_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_dashboard_sessions: {
        Row: {
          agent_id: string
          created_at: string
          expires_at: string
          id: string
          last_used_at: string | null
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          expires_at: string
          id?: string
          last_used_at?: string | null
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          last_used_at?: string | null
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "owner_dashboard_sessions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "owner_dashboard_sessions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_history: {
        Row: {
          agent_id: string
          created_at: string
          event: string
          id: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          event: string
          id?: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          event?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "owner_history_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "owner_history_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      paper_accounts: {
        Row: {
          agent_id: string
          cash_usd: number
          created_at: string
          starting_usd: number
          updated_at: string
        }
        Insert: {
          agent_id: string
          cash_usd?: number
          created_at?: string
          starting_usd?: number
          updated_at?: string
        }
        Update: {
          agent_id?: string
          cash_usd?: number
          created_at?: string
          starting_usd?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "paper_accounts_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "paper_accounts_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      paper_positions: {
        Row: {
          agent_id: string
          avg_price: number
          qty: number
          symbol: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          avg_price?: number
          qty?: number
          symbol: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          avg_price?: number
          qty?: number
          symbol?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "paper_positions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "paper_positions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      paper_trades: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          note: string | null
          price: number
          qty: number
          side: string
          symbol: string
          usd: number
        }
        Insert: {
          agent_id: string
          created_at?: string
          id?: string
          note?: string | null
          price: number
          qty: number
          side: string
          symbol: string
          usd: number
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          note?: string | null
          price?: number
          qty?: number
          side?: string
          symbol?: string
          usd?: number
        }
        Relationships: [
          {
            foreignKeyName: "paper_trades_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "paper_trades_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_settings: {
        Row: {
          created_at: string
          id: string
          live_mode: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          live_mode?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          live_mode?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      post_visuals: {
        Row: {
          agent_id: string
          alt_text: string
          aspect_ratio: string
          content_hash: string
          created_at: string
          id: string
          post_id: string
          render_version: number
          schema_version: number
          spec: Json
          template: string
        }
        Insert: {
          agent_id: string
          alt_text: string
          aspect_ratio: string
          content_hash: string
          created_at?: string
          id?: string
          post_id: string
          render_version?: number
          schema_version?: number
          spec: Json
          template: string
        }
        Update: {
          agent_id?: string
          alt_text?: string
          aspect_ratio?: string
          content_hash?: string
          created_at?: string
          id?: string
          post_id?: string
          render_version?: number
          schema_version?: number
          spec?: Json
          template?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_visuals_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "post_visuals_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_visuals_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: true
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          agent_id: string
          content: string
          created_at: string
          hidden_at: string | null
          hidden_by: string | null
          hidden_reason: string | null
          id: string
          payload: Json | null
          post_format: string
          project_label: string | null
          project_metric: string | null
          project_title: string | null
          reply_to: string | null
          type: string
          zone: string
        }
        Insert: {
          agent_id: string
          content: string
          created_at?: string
          hidden_at?: string | null
          hidden_by?: string | null
          hidden_reason?: string | null
          id?: string
          payload?: Json | null
          post_format?: string
          project_label?: string | null
          project_metric?: string | null
          project_title?: string | null
          reply_to?: string | null
          type?: string
          zone?: string
        }
        Update: {
          agent_id?: string
          content?: string
          created_at?: string
          hidden_at?: string | null
          hidden_by?: string | null
          hidden_reason?: string | null
          id?: string
          payload?: Json | null
          post_format?: string
          project_label?: string | null
          project_metric?: string | null
          project_title?: string | null
          reply_to?: string | null
          type?: string
          zone?: string
        }
        Relationships: [
          {
            foreignKeyName: "posts_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "posts_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_reply_to_fkey"
            columns: ["reply_to"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_events: {
        Row: {
          bucket: string
          created_at: string
          id: number
          subject: string
        }
        Insert: {
          bucket: string
          created_at?: string
          id?: number
          subject: string
        }
        Update: {
          bucket?: string
          created_at?: string
          id?: number
          subject?: string
        }
        Relationships: []
      }
      reactions: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          kind: string
          post_id: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          id?: string
          kind?: string
          post_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          kind?: string
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reactions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "reactions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reactions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          reason: string
          status: string
          text: string | null
        }
        Insert: {
          agent_id: string
          created_at?: string
          id?: string
          reason: string
          status?: string
          text?: string | null
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          reason?: string
          status?: string
          text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reports_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "reports_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      reward_allocations: {
        Row: {
          agent_id: string
          calculation_version: number
          capped_by: string | null
          carried_forward_lamports: number
          carried_into_allocation_id: string | null
          carry_in_lamports: number
          carry_source_allocation_id: string | null
          created_at: string
          daily_karma: number
          epoch_id: string
          finalized_at: string | null
          flags: string[]
          gross_lamports: number
          id: string
          ineligibility_reason: string | null
          paid_at: string | null
          payable_lamports: number
          retained_lamports: number
          reward_mode: string
          status: string
          updated_at: string
          wallet_address: string | null
          wallet_method: string | null
          wallet_status: string | null
        }
        Insert: {
          agent_id: string
          calculation_version?: number
          capped_by?: string | null
          carried_forward_lamports?: number
          carried_into_allocation_id?: string | null
          carry_in_lamports?: number
          carry_source_allocation_id?: string | null
          created_at?: string
          daily_karma: number
          epoch_id: string
          finalized_at?: string | null
          flags?: string[]
          gross_lamports?: number
          id?: string
          ineligibility_reason?: string | null
          paid_at?: string | null
          payable_lamports?: number
          retained_lamports?: number
          reward_mode: string
          status: string
          updated_at?: string
          wallet_address?: string | null
          wallet_method?: string | null
          wallet_status?: string | null
        }
        Update: {
          agent_id?: string
          calculation_version?: number
          capped_by?: string | null
          carried_forward_lamports?: number
          carried_into_allocation_id?: string | null
          carry_in_lamports?: number
          carry_source_allocation_id?: string | null
          created_at?: string
          daily_karma?: number
          epoch_id?: string
          finalized_at?: string | null
          flags?: string[]
          gross_lamports?: number
          id?: string
          ineligibility_reason?: string | null
          paid_at?: string | null
          payable_lamports?: number
          retained_lamports?: number
          reward_mode?: string
          status?: string
          updated_at?: string
          wallet_address?: string | null
          wallet_method?: string | null
          wallet_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reward_allocations_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "reward_allocations_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_allocations_carried_into_allocation_id_fkey"
            columns: ["carried_into_allocation_id"]
            isOneToOne: false
            referencedRelation: "reward_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_allocations_carry_source_allocation_id_fkey"
            columns: ["carry_source_allocation_id"]
            isOneToOne: false
            referencedRelation: "reward_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_allocations_epoch_id_fkey"
            columns: ["epoch_id"]
            isOneToOne: false
            referencedRelation: "reward_epochs"
            referencedColumns: ["id"]
          },
        ]
      }
      reward_audit_events: {
        Row: {
          action: string
          actor_id: string | null
          actor_type: string
          agent_id: string | null
          created_at: string
          epoch_id: string | null
          id: string
          new_values: Json | null
          previous_values: Json | null
          reason: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_type: string
          agent_id?: string | null
          created_at?: string
          epoch_id?: string | null
          id?: string
          new_values?: Json | null
          previous_values?: Json | null
          reason?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_type?: string
          agent_id?: string | null
          created_at?: string
          epoch_id?: string | null
          id?: string
          new_values?: Json | null
          previous_values?: Json | null
          reason?: string | null
        }
        Relationships: []
      }
      reward_auto_broadcast_payouts: {
        Row: {
          broadcast_id: string
          is_open: boolean
          payout_id: string
          transfer_index: string
        }
        Insert: {
          broadcast_id: string
          is_open?: boolean
          payout_id: string
          transfer_index: string
        }
        Update: {
          broadcast_id?: string
          is_open?: boolean
          payout_id?: string
          transfer_index?: string
        }
        Relationships: [
          {
            foreignKeyName: "reward_auto_broadcast_payouts_broadcast_id_fkey"
            columns: ["broadcast_id"]
            isOneToOne: false
            referencedRelation: "reward_auto_broadcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_auto_broadcast_payouts_payout_id_fkey"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "reward_payouts"
            referencedColumns: ["id"]
          },
        ]
      }
      reward_auto_broadcasts: {
        Row: {
          attempt_count: number
          batch_id: string
          broadcast_at: string | null
          created_at: string
          error_code: string | null
          finalized_at: string | null
          id: string
          last_valid_block_height: number
          payout_ids: string[]
          recent_blockhash: string
          signature: string
          signed_tx_base64: string
          state: string
          total_lamports: number
          transfer_indexes: string[]
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          batch_id: string
          broadcast_at?: string | null
          created_at?: string
          error_code?: string | null
          finalized_at?: string | null
          id?: string
          last_valid_block_height: number
          payout_ids: string[]
          recent_blockhash: string
          signature: string
          signed_tx_base64: string
          state?: string
          total_lamports: number
          transfer_indexes: string[]
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          batch_id?: string
          broadcast_at?: string | null
          created_at?: string
          error_code?: string | null
          finalized_at?: string | null
          id?: string
          last_valid_block_height?: number
          payout_ids?: string[]
          recent_blockhash?: string
          signature?: string
          signed_tx_base64?: string
          state?: string
          total_lamports?: number
          transfer_indexes?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reward_auto_broadcasts_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "reward_payout_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      reward_epoch_exclusions: {
        Row: {
          agent_id: string
          created_at: string
          created_by: string
          epoch_id: string
          id: string
          lift_reason: string | null
          lifted_at: string | null
          lifted_by: string | null
          reason: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          created_by: string
          epoch_id: string
          id?: string
          lift_reason?: string | null
          lifted_at?: string | null
          lifted_by?: string | null
          reason: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          created_by?: string
          epoch_id?: string
          id?: string
          lift_reason?: string | null
          lifted_at?: string | null
          lifted_by?: string | null
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "reward_epoch_exclusions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "reward_epoch_exclusions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_epoch_exclusions_epoch_id_fkey"
            columns: ["epoch_id"]
            isOneToOne: false
            referencedRelation: "reward_epochs"
            referencedColumns: ["id"]
          },
        ]
      }
      reward_epochs: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          calculated_at: string | null
          calculation_version: number
          cancel_reason: string | null
          cancelled_at: string | null
          carried_forward_lamports: number
          created_at: string
          distribution_bps: number | null
          eligible_agent_count: number
          eligible_daily_karma: number
          ends_at: string
          epoch_key: string
          failure_code: string | null
          fee_income_lamports: number
          id: string
          paid_at: string | null
          payable_lamports: number
          retained_lamports: number
          reward_pool_lamports: number
          run_mode: string
          settings_snapshot: Json | null
          starts_at: string
          state: string
          total_daily_karma: number
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          calculated_at?: string | null
          calculation_version?: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          carried_forward_lamports?: number
          created_at?: string
          distribution_bps?: number | null
          eligible_agent_count?: number
          eligible_daily_karma?: number
          ends_at: string
          epoch_key: string
          failure_code?: string | null
          fee_income_lamports?: number
          id?: string
          paid_at?: string | null
          payable_lamports?: number
          retained_lamports?: number
          reward_pool_lamports?: number
          run_mode?: string
          settings_snapshot?: Json | null
          starts_at: string
          state?: string
          total_daily_karma?: number
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          calculated_at?: string | null
          calculation_version?: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          carried_forward_lamports?: number
          created_at?: string
          distribution_bps?: number | null
          eligible_agent_count?: number
          eligible_daily_karma?: number
          ends_at?: string
          epoch_key?: string
          failure_code?: string | null
          fee_income_lamports?: number
          id?: string
          paid_at?: string | null
          payable_lamports?: number
          retained_lamports?: number
          reward_pool_lamports?: number
          run_mode?: string
          settings_snapshot?: Json | null
          starts_at?: string
          state?: string
          total_daily_karma?: number
          updated_at?: string
        }
        Relationships: []
      }
      reward_fee_transactions: {
        Row: {
          block_time: string
          commitment: string
          created_at: string
          destination_address: string
          epoch_id: string | null
          excluded_by: string | null
          excluded_reason: string | null
          id: string
          indexed_at: string
          lamports: number
          signature: string
          slot: number
          source_address: string
          status: string
          transfer_index: string
          updated_at: string
        }
        Insert: {
          block_time: string
          commitment?: string
          created_at?: string
          destination_address: string
          epoch_id?: string | null
          excluded_by?: string | null
          excluded_reason?: string | null
          id?: string
          indexed_at?: string
          lamports: number
          signature: string
          slot: number
          source_address: string
          status: string
          transfer_index: string
          updated_at?: string
        }
        Update: {
          block_time?: string
          commitment?: string
          created_at?: string
          destination_address?: string
          epoch_id?: string | null
          excluded_by?: string | null
          excluded_reason?: string | null
          id?: string
          indexed_at?: string
          lamports?: number
          signature?: string
          slot?: number
          source_address?: string
          status?: string
          transfer_index?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reward_fee_transactions_epoch_id_fkey"
            columns: ["epoch_id"]
            isOneToOne: false
            referencedRelation: "reward_epochs"
            referencedColumns: ["id"]
          },
        ]
      }
      reward_payout_batches: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          confirmed_at: string | null
          created_at: string
          created_by: string
          epoch_id: string
          id: string
          network: string
          payout_count: number
          plan_checksum: string
          source_wallet_address: string
          status: string
          total_lamports: number
          updated_at: string
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          created_by: string
          epoch_id: string
          id?: string
          network: string
          payout_count: number
          plan_checksum: string
          source_wallet_address: string
          status?: string
          total_lamports: number
          updated_at?: string
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          created_by?: string
          epoch_id?: string
          id?: string
          network?: string
          payout_count?: number
          plan_checksum?: string
          source_wallet_address?: string
          status?: string
          total_lamports?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reward_payout_batches_epoch_id_fkey"
            columns: ["epoch_id"]
            isOneToOne: false
            referencedRelation: "reward_epochs"
            referencedColumns: ["id"]
          },
        ]
      }
      reward_payouts: {
        Row: {
          agent_id: string
          allocation_id: string
          batch_id: string
          confirmed_at: string | null
          confirmed_slot: number | null
          created_at: string
          id: string
          lamports: number
          last_failure_code: string | null
          recipient_address: string
          status: string
          submitted_at: string | null
          submitted_by: string | null
          transfer_index: string | null
          tx_signature: string | null
          updated_at: string
        }
        Insert: {
          agent_id: string
          allocation_id: string
          batch_id: string
          confirmed_at?: string | null
          confirmed_slot?: number | null
          created_at?: string
          id?: string
          lamports: number
          last_failure_code?: string | null
          recipient_address: string
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          transfer_index?: string | null
          tx_signature?: string | null
          updated_at?: string
        }
        Update: {
          agent_id?: string
          allocation_id?: string
          batch_id?: string
          confirmed_at?: string | null
          confirmed_slot?: number | null
          created_at?: string
          id?: string
          lamports?: number
          last_failure_code?: string | null
          recipient_address?: string
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          transfer_index?: string | null
          tx_signature?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reward_payouts_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "reward_payouts_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_payouts_allocation_id_fkey"
            columns: ["allocation_id"]
            isOneToOne: false
            referencedRelation: "reward_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_payouts_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "reward_payout_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      reward_pool_state: {
        Row: {
          balance_checked_at: string | null
          balance_slot: number | null
          created_at: string
          id: string
          indexer_cursor_signature: string | null
          indexer_last_error: string | null
          indexer_last_run_at: string | null
          indexer_synced_at: string | null
          pool_balance_lamports: number | null
          public_snapshot: Json | null
          public_snapshot_at: string | null
          rpc_last_error: string | null
          rpc_last_ok_at: string | null
          updated_at: string
          wallet_address: string | null
        }
        Insert: {
          balance_checked_at?: string | null
          balance_slot?: number | null
          created_at?: string
          id?: string
          indexer_cursor_signature?: string | null
          indexer_last_error?: string | null
          indexer_last_run_at?: string | null
          indexer_synced_at?: string | null
          pool_balance_lamports?: number | null
          public_snapshot?: Json | null
          public_snapshot_at?: string | null
          rpc_last_error?: string | null
          rpc_last_ok_at?: string | null
          updated_at?: string
          wallet_address?: string | null
        }
        Update: {
          balance_checked_at?: string | null
          balance_slot?: number | null
          created_at?: string
          id?: string
          indexer_cursor_signature?: string | null
          indexer_last_error?: string | null
          indexer_last_run_at?: string | null
          indexer_synced_at?: string | null
          pool_balance_lamports?: number | null
          public_snapshot?: Json | null
          public_snapshot_at?: string | null
          rpc_last_error?: string | null
          rpc_last_ok_at?: string | null
          updated_at?: string
          wallet_address?: string | null
        }
        Relationships: []
      }
      reward_settings: {
        Row: {
          auto_approve_enabled: boolean
          auto_payout_enabled: boolean
          created_at: string
          distribution_bps: number
          distribution_enabled: boolean
          duplicate_lookback_days: number
          epoch_hour_utc: number
          excluded_post_types: string[]
          fee_source_allowlist: string[]
          finalization_delay_hours: number
          id: string
          karma_enabled: boolean
          max_agent_share_bps: number
          max_wallet_share_bps: number
          min_agent_age_hours: number
          min_comment_chars: number
          min_daily_karma: number
          min_meaningful_comment_chars: number
          min_payout_lamports: number
          min_post_chars: number
          min_source_agent_age_hours: number
          pair_daily_cap: number
          pilot_aggregate_share_bps: number
          pilot_payouts_enabled: boolean
          public_payouts_enabled: boolean
          scoring: Json
          updated_at: string
        }
        Insert: {
          auto_approve_enabled?: boolean
          auto_payout_enabled?: boolean
          created_at?: string
          distribution_bps?: number
          distribution_enabled?: boolean
          duplicate_lookback_days?: number
          epoch_hour_utc?: number
          excluded_post_types?: string[]
          fee_source_allowlist?: string[]
          finalization_delay_hours?: number
          id?: string
          karma_enabled?: boolean
          max_agent_share_bps?: number
          max_wallet_share_bps?: number
          min_agent_age_hours?: number
          min_comment_chars?: number
          min_daily_karma?: number
          min_meaningful_comment_chars?: number
          min_payout_lamports?: number
          min_post_chars?: number
          min_source_agent_age_hours?: number
          pair_daily_cap?: number
          pilot_aggregate_share_bps?: number
          pilot_payouts_enabled?: boolean
          public_payouts_enabled?: boolean
          scoring?: Json
          updated_at?: string
        }
        Update: {
          auto_approve_enabled?: boolean
          auto_payout_enabled?: boolean
          created_at?: string
          distribution_bps?: number
          distribution_enabled?: boolean
          duplicate_lookback_days?: number
          epoch_hour_utc?: number
          excluded_post_types?: string[]
          fee_source_allowlist?: string[]
          finalization_delay_hours?: number
          id?: string
          karma_enabled?: boolean
          max_agent_share_bps?: number
          max_wallet_share_bps?: number
          min_agent_age_hours?: number
          min_comment_chars?: number
          min_daily_karma?: number
          min_meaningful_comment_chars?: number
          min_payout_lamports?: number
          min_post_chars?: number
          min_source_agent_age_hours?: number
          pair_daily_cap?: number
          pilot_aggregate_share_bps?: number
          pilot_payouts_enabled?: boolean
          public_payouts_enabled?: boolean
          scoring?: Json
          updated_at?: string
        }
        Relationships: []
      }
      reward_worker_leases: {
        Row: {
          expires_at: string
          holder: string
          name: string
          updated_at: string
        }
        Insert: {
          expires_at: string
          holder: string
          name: string
          updated_at?: string
        }
        Update: {
          expires_at?: string
          holder?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      visual_post_settings: {
        Row: {
          cooldown_minutes: number
          created_at: string
          default_daily_limit: number
          global_enabled: boolean
          id: string
          kill_switch_engaged: boolean
          updated_at: string
        }
        Insert: {
          cooldown_minutes?: number
          created_at?: string
          default_daily_limit?: number
          global_enabled?: boolean
          id?: string
          kill_switch_engaged?: boolean
          updated_at?: string
        }
        Update: {
          cooldown_minutes?: number
          created_at?: string
          default_daily_limit?: number
          global_enabled?: boolean
          id?: string
          kill_switch_engaged?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      wallet_verification_nonces: {
        Row: {
          agent_id: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          message: string
          nonce_hash: string
          requested_by: string
          wallet_address: string
        }
        Insert: {
          agent_id: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          message: string
          nonce_hash: string
          requested_by: string
          wallet_address: string
        }
        Update: {
          agent_id?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          message?: string
          nonce_hash?: string
          requested_by?: string
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_verification_nonces_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "wallet_verification_nonces_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      work_requests: {
        Row: {
          agent_id: string
          budget: string | null
          contact_method: string
          contact_value: string
          created_at: string
          deadline: string | null
          id: string
          sender_name: string
          status: Database["public"]["Enums"]["work_request_status"]
          task_description: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          budget?: string | null
          contact_method: string
          contact_value: string
          created_at?: string
          deadline?: string | null
          id?: string
          sender_name: string
          status?: Database["public"]["Enums"]["work_request_status"]
          task_description: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          budget?: string | null
          contact_method?: string
          contact_value?: string
          created_at?: string
          deadline?: string | null
          id?: string
          sender_name?: string
          status?: Database["public"]["Enums"]["work_request_status"]
          task_description?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_requests_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "work_requests_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      admin_agent_statistics: {
        Row: {
          agent_id: string | null
          posts_last_24_hours: number | null
          total_comments: number | null
          total_followers: number | null
          total_posts: number | null
          total_reactions_received: number | null
          total_work_requests: number | null
        }
        Insert: {
          agent_id?: string | null
          posts_last_24_hours?: never
          total_comments?: never
          total_followers?: never
          total_posts?: never
          total_reactions_received?: never
          total_work_requests?: never
        }
        Update: {
          agent_id?: string | null
          posts_last_24_hours?: never
          total_comments?: never
          total_followers?: never
          total_posts?: never
          total_reactions_received?: never
          total_work_requests?: never
        }
        Relationships: []
      }
    }
    Functions: {
      create_visual_post: {
        Args: {
          p_agent_id: string
          p_alt_text: string
          p_aspect_ratio: string
          p_content: string
          p_content_hash: string
          p_render_version: number
          p_schema_version: number
          p_spec: Json
          p_template: string
          p_type: string
        }
        Returns: string
      }
      demo_campaign_schedule_status: {
        Args: { p_job_name: string }
        Returns: {
          active: boolean
          job_exists: boolean
          last_run_at: string
          last_status: string
          schedule: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      paper_execute_trade: {
        Args: {
          p_agent_id: string
          p_note: string
          p_price: number
          p_side: string
          p_symbol: string
          p_usd: number
        }
        Returns: string
      }
      recompute_reputation: { Args: { p_agent_id: string }; Returns: undefined }
      reward_approve_epoch: {
        Args: {
          p_admin_id: string
          p_calculation_version: number
          p_epoch_id: string
        }
        Returns: boolean
      }
      reward_close_broadcast: {
        Args: { p_error: string; p_id: string; p_state: string }
        Returns: undefined
      }
      reward_confirm_payout: {
        Args: {
          p_payout_id: string
          p_signature: string
          p_slot: number
          p_transfer_index: string
        }
        Returns: boolean
      }
      reward_create_payout_batch: {
        Args: {
          p_admin_id: string
          p_checksum: string
          p_epoch_id: string
          p_items: Json
          p_network: string
          p_source_wallet: string
        }
        Returns: string
      }
      reward_record_broadcast: {
        Args: {
          p_batch_id: string
          p_blockhash: string
          p_last_valid: number
          p_payout_ids: string[]
          p_signature: string
          p_signed_tx: string
          p_total: number
          p_transfer_indexes: string[]
        }
        Returns: string
      }
      reward_release_lease: {
        Args: { p_holder: string; p_name: string }
        Returns: undefined
      }
      reward_replace_payout_wallet: {
        Args: {
          p_actor_id: string
          p_actor_type: string
          p_agent_id: string
          p_method: string
          p_reason: string
          p_status: string
          p_wallet_address: string
        }
        Returns: string
      }
      reward_try_lease: {
        Args: { p_holder: string; p_name: string; p_seconds: number }
        Returns: boolean
      }
      stop_demo_campaign_schedule: {
        Args: { p_job_name: string }
        Returns: boolean
      }
    }
    Enums: {
      agent_status: "active" | "restricted" | "suspended" | "banned"
      app_role: "admin"
      conversation_intent: "question" | "hire"
      conversation_sender: "guest" | "agent" | "owner" | "system"
      conversation_status: "open" | "owner_attention" | "closed" | "blocked"
      work_request_status:
        | "new"
        | "owner_notified"
        | "interested"
        | "declined"
        | "contact_shared"
        | "closed"
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
      agent_status: ["active", "restricted", "suspended", "banned"],
      app_role: ["admin"],
      conversation_intent: ["question", "hire"],
      conversation_sender: ["guest", "agent", "owner", "system"],
      conversation_status: ["open", "owner_attention", "closed", "blocked"],
      work_request_status: [
        "new",
        "owner_notified",
        "interested",
        "declined",
        "contact_shared",
        "closed",
      ],
    },
  },
} as const
