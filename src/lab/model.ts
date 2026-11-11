import type { AccessProfile } from './access-model'
import type { AlgorithmProfile } from './algorithm-model'
import type { ClosureProfile } from './closure-model'
import type { FrameProfile } from './frame-model'
import type { RadioProfile } from './radio-model'
import type { DhcpProfile } from './dhcp-model'
import type { VlsmProfile } from './vlsm-model'
import type { RouteProfile } from './route-model'
import type { ContentionProfile } from './contention-model'
import type { TransactionProfile } from './transaction-model'
import type { RelationProfile } from './relation-model'
import type { SignalCase } from './signal-model'
import type { SwitchingProfile } from './switching-model'
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
  mode: { kind: 'real' | 'simulation' | 'trace' | 'documentary'; engine: string; version: string; limits: string }
  prompt: string
  hints: string[]
  solution: string
  claims: Claim[]
  /** Prepared diagnostics only; feedback and personal notes are never interpreted. */
  learning?: {
    diagnostics: { id: string; objectiveIds: string[]; severity: 'ordinary' | 'critical'; choiceOptionIds?: string[] }[]
    rechecksDiagnosticIds: string[]
  }
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
export interface SignalModelActivity extends ActivityBase {
  kind: 'signal-model'
  phase: 'practice'
  cases: SignalCase[]
}
export interface FrameModelActivity extends ActivityBase {
  kind: 'frame-model'
  phase: 'practice'
  profile: FrameProfile
}
export interface AccessModelActivity extends ActivityBase {
  kind: 'access-model'
  phase: 'practice'
  profile: AccessProfile
}
export interface StackModelActivity extends ActivityBase {
  kind: 'stack-model'
  phase: 'practice'
}
export interface RelationModelActivity extends ActivityBase {
  kind: 'relation-model'
  phase: 'practice'
  profile: RelationProfile
}
export interface ClosureModelActivity extends ActivityBase {
  kind: 'closure-model'
  phase: 'practice'
  profile: ClosureProfile
}
export interface AlgorithmModelActivity extends ActivityBase {
  kind: 'algorithm-model'
  phase: 'practice'
  profile: AlgorithmProfile
}
export interface SwitchingModelActivity extends ActivityBase {
  kind: 'switching-model'
  phase: 'practice'
  profile: SwitchingProfile
}
export interface RadioModelActivity extends ActivityBase {
  kind: 'radio-model'
  phase: 'practice'
  profile: RadioProfile
}
export interface DhcpModelActivity extends ActivityBase {
  kind: 'dhcp-model'
  phase: 'practice'
  profile: DhcpProfile
}
export interface TransactionModelActivity extends ActivityBase {
  kind: 'transaction-model'
  phase: 'practice'
  profile: TransactionProfile
}
export interface VlsmModelActivity extends ActivityBase {
  kind: 'vlsm-model'
  phase: 'practice'
  profile: VlsmProfile
}
export interface RouteModelActivity extends ActivityBase {
  kind: 'route-model'
  phase: 'practice'
  profile: RouteProfile
}
export interface ContentionModelActivity extends ActivityBase {
  kind: 'contention-model'
  phase: 'practice'
  profile: ContentionProfile
}
export type PredictionActivity = FrameModelActivity | AccessModelActivity | StackModelActivity | RelationModelActivity
  | ClosureModelActivity | AlgorithmModelActivity | SwitchingModelActivity | RadioModelActivity | DhcpModelActivity
  | TransactionModelActivity | VlsmModelActivity | RouteModelActivity | ContentionModelActivity
export type Activity = ChoiceActivity | SqlActivity | CodeActivity | HtmlActivity | IPv4ModelActivity | SignalModelActivity | PredictionActivity
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
export type ExamQuestion = Pick<ChoiceActivity, 'id' | 'familyId' | 'scenarioId' | 'objectiveIds' | 'provenance' | 'prompt' | 'options' | 'claims'>
export interface ExamSection {
  title: string
  scenario?: string
  questions: ExamQuestion[]
  reserves: ExamQuestion[]
}
export interface ExamForm {
  id: string
  version: string
  title: string
  state: EditorialState
  kind: 'topic' | 'case-iii' | 'full-iii'
  partition: 'training' | 'reserved'
  durationMinutes: number
  sections: ExamSection[]
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
  exams?: ExamForm[]
  examObjectiveIds?: string[]
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
  learningContextId?: string
  diagnosticIds?: string[]
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
  learningContextId?: string
}
export interface Exposure extends EventBase {
  kind: 'exposure'
  familyId: string
  reason: 'presented' | 'solution' | 'external'
  learningContextId?: string
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
  learningContextId?: string
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
export interface ExamRevision extends EventBase {
  kind: 'exam-revision'
  packageId: string
  packageVersion: string
  examId: string
  examVersion: string
  runId: string
  parentIds: string[]
  startedAt: string
  deadlineAt: string
  answers: [questionId: string, optionId: string][]
  submitted: 'manual' | 'expired' | null
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
export interface LearningClock {
  day: string
  zone: string
  /** Minutes east of UTC, as captured in the named zone. */
  offsetMinutes: number
  clockSessionId: string
  monotonicMs: number
}
export type LearningTarget = (ActivityRef & { kind: 'activity'; attemptGroupId: string })
  | { kind: 'lesson'; packageId: string; packageVersion: string; lessonId: string; lessonVersion: string }
/** Prospective, declared device time and causal context. Never backfill older facts. */
export interface LearningContext extends EventBase {
  kind: 'learning-context'
  contractVersion: 1 | 2
  studySessionId: string
  action: 'present' | 'answer' | 'help' | 'reading' | 'reset' | 'reference'
  /** Required only on v2 presentations. Text support is not an exact solution or a family exposure. */
  referenceVisible?: boolean
  target: LearningTarget
  factIds: string[]
  parentIds: string[]
  presentationId: string | null
  clock: LearningClock
}
export type LabEvent = Attempt | Draft | Exposure | Assistance | SessionPosition | NoteRevision
  | IPv4PredictionEvent | IPv4RevealEvent | IPv4ResetEvent
  | LearningContext | ExamRevision
export interface EventBatch {
  schema: 1
  privacy: 'tai-lab-private'
  accountId: string
  events: LabEvent[]
}
