export type SkillSelectionMode = 'legacy_all' | 'selected' | 'all'
export type EmployeeAssetType = 'responsibility' | 'boundary' | 'workflow' | 'acceptance'
export type EmployeeCandidateType = EmployeeAssetType | 'knowledge' | 'skill'
export type EmployeeScope = 'employee' | 'workspace' | 'organization'
export type EmployeeCandidateStatus = 'pending' | 'processing' | 'accepted' | 'rejected' | 'expired' | 'failed'

export interface DigitalEmployeeProfile {
  bot_id: string
  role_summary: string
  responsibilities: string[]
  boundaries: string[]
  standard_inputs: string[]
  deliverables: string[]
  advanced_instructions: string
  revision: number
  created_at: string
  updated_at: string
}

export interface DigitalEmployeeAssetVersion {
  id: string
  asset_id: string
  version: number
  body: Record<string, unknown>
  source_type: 'user' | 'conversation' | 'task' | 'template' | 'restore'
  source_ref: string
  change_summary: string
  confirmed_at: string
  created_at: string
}

export interface DigitalEmployeeAsset {
  id: string
  bot_id: string
  workspace_id: string
  asset_type: EmployeeAssetType
  title: string
  current_version_id: string
  status: 'active' | 'archived'
  created_at: string
  updated_at: string
  current_version?: DigitalEmployeeAssetVersion | null
}

export interface DigitalEmployeeCandidate {
  id: string
  bot_id: string
  conversation_id: string
  workspace_id: string
  candidate_type: EmployeeCandidateType
  scope: EmployeeScope
  title: string
  body: Record<string, unknown>
  evidence: Record<string, unknown>
  fingerprint: string
  conflict_ref: string
  risk_level: 'low' | 'medium' | 'high'
  status: EmployeeCandidateStatus
  target_type: string
  target_ref: string
  error_message: string
  created_at: string
  decided_at: string
}

export interface ResolvedWorkspaceContext {
  workspaceId: string
  rootPath: string
  workspaceName: string
  source: 'explicit' | 'conversation' | 'employee_default' | 'active' | 'sandbox'
  available: boolean
  reason: string
}
