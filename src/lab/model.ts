import type { IPv4Input, IPv4Prediction, IPv4Comparison } from './ipv4'

/** Private content is loaded at runtime. Never import a real study package into the public bundle. */
export type EditorialState = 'planned' | 'authored' | 'review' | 'correction' | 'validated' | 'withdrawn'
export type Phase = 'practice' | 'immediate' | 'reserved' | 'delayed'
export type Gate = 'accuracy' | 'pedagogy' | 'engine' | 'interface' | 'data' | 'evaluation'
export const requiredGates: Gate[] = ['accuracy', 'pedagogy', 'engine', 'interface', 'data', 'evaluation']

export interface Source {
  id: string
  title: string
  url: string
  edition: string | null
  locator: string | null
  consultedOn: string | null
  verification: 'candidate' | 'verified'
  authority: 'primary' | 'secondary' | 'execution'
  rights: 'reference-only' | 'original' | 'licensed-private' | 'open'
}
export interface Claim { text: string; sourceId: string; locator: string }
export interface Evidence {
  id: string
  subjectId: string
  subjectVersion: string
  gate: Gate
  method: 'source-review' | 'execution' | 'automated-browser' | 'physical-device' | 'manual'
  environment: string
  procedure: string
  expected: string
  observed: string
  result: 'pass' | 'fail'
  artifact: string
  sha256: string
  recordedAt: string
}
export interface Objective {
  id: string
  unitId: string
  topicId: string
  statement: string
  concepts: string[]
  depth: 'A' | 'R' | 'R/A'
  officialClauses: string[]
  state: EditorialState
  lessonIds: string[]
  practiceIds: string[]
  immediateIds: string[]
  reservedIds: string[]
  delayedIds: string[]
  sourceIds: string[]
}
export interface Lesson {
  id: string
  version: string
  title: string
  objectiveIds: string[]
  prerequisites: string[]
  minutes: number
  state: EditorialState
  explanation: { title: string; body: string }[]
  workedExample: { title: string; body: string }[]
  activityIds: string[]
  material: { resourceId: string; sectionId: string }
  claims: Claim[]
}
export interface ActivityBase {
  id: string
  version: string
  title: string
  objectiveIds: string[]
  familyId: string
  scenarioId: string
  phase: Phase
  /** Delayed retention may revisit a trained family; it never constitutes fresh transfer. */
  evaluationIntent?: 'retention' | 'transfer'
  state: EditorialState
  provenance: {
    kind: 'official-tai' | 'official-other' | 'adapted' | 'original' | 'didactic'
    originalId?: string
    officialAnswer?: string
    technicalAnswer?: string
    status: 'eligible' | 'annulled' | 'disputed' | 'unreconciled'
  }
  mode: { kind: 'real' | 'simulation' | 'trace'; engine: string; version: string; limits: string }
  prompt: string
  hints: string[]
  solution: string
  claims: Claim[]
}
export interface ChoiceActivity extends ActivityBase {
  kind: 'choice'
  options: { id: string; text: string; explanation: string; correct: boolean }[]
}
export interface SqlActivity extends ActivityBase {
  kind: 'sql'
  starter: string
  referenceQuery: string
  comparison: 'bag' | 'set' | 'ordered'
  datasets: { id: string; setup: string }[]
}
/** Inputs are supplied as `input`; expected stdout is prepared and verified during authoring. */
export interface CodeActivity extends ActivityBase {
  kind: 'code'
  language: 'python' | 'javascript'
  starter: string
  datasets: { id: string; input: unknown; expectedOutput: string[] }[]
}
export interface HtmlCheck {
  selector: string
  kind: 'count' | 'text' | 'style' | 'attribute'
  property?: string
  expected: string
}
export interface HtmlActivity extends ActivityBase {
  kind: 'html-css'
  starter: { html: string; css: string }
  cases: { id: string; width: number; checks: HtmlCheck[] }[]
}
export interface IPv4ModelActivity extends ActivityBase {
  kind: 'ipv4-model'
  phase: 'practice'
  initialInput: IPv4Input
}
export type Activity = ChoiceActivity | SqlActivity | CodeActivity | HtmlActivity | IPv4ModelActivity
export interface GuidedStage {
  id: string
  kind: 'recover' | 'understand' | 'experiment' | 'transfer' | 'close'
  title: string
  minutes: number
  instructions: string
  activityIds: string[]
  readings: { lessonId: string; explanationIndexes: number[]; workedExampleIndexes: number[] }[]
}
export interface GuidedSession {
  id: string
  version: string
  title: string
  objectiveIds: string[]
  state: EditorialState
  stages: GuidedStage[]
}
export interface LabPackage {
  schema: 1
  privacy: 'tai-lab-private'
  id: string
  version: string
  title: string
  objectives: Objective[]
  sources: Source[]
  lessons: Lesson[]
  activities: Activity[]
  evidence: Evidence[]
  sessions?: GuidedSession[]
}

export type Answer = string | null
export interface EventBase {
  id: string
  accountId: string
  deviceId: string
  createdAt: string
}
export interface ActivityRef { activityId: string; activityVersion: string; packageId: string; packageVersion: string }
export interface Attempt extends EventBase, ActivityRef {
  kind: 'attempt'
  familyId: string
  objectiveIds: string[]
  attemptGroupId: string
  ordinal: number
  answer: Answer
  outcome: 'correct' | 'incorrect' | 'omitted' | 'partial'
  hintCount: number
  solutionViewed: boolean
  activeMs: number
  phase: Phase
  feedback: string
  gradingVersion: string
  /** Numeric comparison only; the conceptual note is retained but never graded. */
  ipv4?: IPv4AttemptPayload
}
export interface Draft extends EventBase, ActivityRef {
  kind: 'draft'
  attemptGroupId: string
  parentIds: string[]
  value: string
  position: number
  valueFormat?: 'ipv4-model-v1'
}
export interface Assistance extends EventBase, ActivityRef {
  kind: 'assistance'
  attemptGroupId: string
  hintCount: number
  solutionViewed: boolean
}
export interface Exposure extends EventBase {
  kind: 'exposure'
  familyId: string
  reason: 'presented' | 'solution' | 'external'
}
export interface IPv4AttemptPayload {
  modelVersion: string
  predictionId: string
  input: IPv4Input
  prediction: IPv4Prediction
  comparison: IPv4Comparison
}
export interface IPv4PredictionEvent extends EventBase, ActivityRef {
  kind: 'ipv4-prediction'
  modelVersion: string
  familyId: string
  objectiveIds: string[]
  attemptGroupId: string
  ordinal: number
  input: IPv4Input
  prediction: IPv4Prediction
  hintCount: number
  solutionViewed: boolean
  activeMs: number
}
/** Explicit causal links make reveal order independent of device wall clocks. */
export interface IPv4RevealEvent extends EventBase, ActivityRef {
  kind: 'ipv4-reveal'
  modelVersion: string
  attemptGroupId: string
  familyId: string
  predictionId: string
  attemptId: string
  assistanceId: string
  exposureId: string
}
export interface IPv4ResetEvent extends EventBase, ActivityRef {
  kind: 'ipv4-reset'
  modelVersion: string
  attemptGroupId: string
  predictionId: string | null
  revealId: string | null
  initialInput: IPv4Input
}
/** Navigation is append-only. Its date orders a resume suggestion, never answer conflicts or mastery. */
export interface SessionPosition extends EventBase {
  kind: 'session-position'
  packageId: string
  packageVersion: string
  sessionId: string
  sessionVersion: string
  stageId: string
  activityId: string | null
  completed: boolean
}
export type NoteTarget = (ActivityRef & { kind: 'activity'; purpose: 'prediction' })
  | { kind: 'session'; purpose: 'reflection'; packageId: string; packageVersion: string; sessionId: string; sessionVersion: string }
/** Personal text is never graded. Concurrent revisions retain both branches until an explicit choice. */
export interface NoteRevision extends EventBase {
  kind: 'note'
  target: NoteTarget
  parentIds: string[]
  value: string
}
export type LabEvent = Attempt | Draft | Exposure | Assistance | SessionPosition | NoteRevision
  | IPv4PredictionEvent | IPv4RevealEvent | IPv4ResetEvent
export interface EventBatch {
  schema: 1
  privacy: 'tai-lab-private'
  accountId: string
  events: LabEvent[]
}
