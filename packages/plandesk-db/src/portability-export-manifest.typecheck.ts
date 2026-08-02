/**
 * Compile-time guards: each rows-scope serializer return must match its export
 * collection element type. A mismatched serializer prevents compilation here.
 */
import type {
  PlandeskExportAgentRun,
  PlandeskExportArtifact,
  PlandeskExportComment,
  PlandeskExportDocument,
  PlandeskExportEdge,
  PlandeskExportFile,
  PlandeskExportFolder,
  PlandeskExportGoal,
  PlandeskExportNote,
  PlandeskExportPrototype,
  PlandeskExportTag,
  PlandeskExportTask,
} from './portability.js';
import { PLANDESK_EXPORT_TABLE_MANIFEST } from './portability-export-manifest.js';

type RowSerializerGuard<Serialized, CollectionElement> = Serialized extends CollectionElement
  ? CollectionElement extends Serialized
    ? true
    : never
  : never;

type _GoalGuard = RowSerializerGuard<
  ReturnType<typeof PLANDESK_EXPORT_TABLE_MANIFEST.goals.serialize>,
  PlandeskExportGoal
>;
type _TaskGuard = RowSerializerGuard<
  ReturnType<typeof PLANDESK_EXPORT_TABLE_MANIFEST.tasks.serialize>,
  PlandeskExportTask
>;
type _TagGuard = RowSerializerGuard<
  ReturnType<typeof PLANDESK_EXPORT_TABLE_MANIFEST.tags.serialize>,
  PlandeskExportTag
>;
type _EdgeGuard = RowSerializerGuard<
  ReturnType<typeof PLANDESK_EXPORT_TABLE_MANIFEST.edges.serialize>,
  PlandeskExportEdge
>;
type _FolderGuard = RowSerializerGuard<
  ReturnType<typeof PLANDESK_EXPORT_TABLE_MANIFEST.folders.serialize>,
  PlandeskExportFolder
>;
type _PrototypeGuard = RowSerializerGuard<
  ReturnType<typeof PLANDESK_EXPORT_TABLE_MANIFEST.prototypes.serialize>,
  PlandeskExportPrototype
>;
type _DocumentGuard = RowSerializerGuard<
  ReturnType<typeof PLANDESK_EXPORT_TABLE_MANIFEST.documents.serialize>,
  PlandeskExportDocument
>;
type _NoteGuard = RowSerializerGuard<
  ReturnType<typeof PLANDESK_EXPORT_TABLE_MANIFEST.notes.serialize>,
  PlandeskExportNote
>;
type _CommentGuard = RowSerializerGuard<
  ReturnType<typeof PLANDESK_EXPORT_TABLE_MANIFEST.comments.serialize>,
  PlandeskExportComment
>;
type _AgentRunGuard = RowSerializerGuard<
  ReturnType<typeof PLANDESK_EXPORT_TABLE_MANIFEST.agent_runs.serialize>,
  PlandeskExportAgentRun
>;
type _FileGuard = RowSerializerGuard<
  ReturnType<typeof PLANDESK_EXPORT_TABLE_MANIFEST.files.serialize>,
  PlandeskExportFile
>;
type _ArtifactGuard = RowSerializerGuard<
  ReturnType<typeof PLANDESK_EXPORT_TABLE_MANIFEST.artifacts.serialize>,
  PlandeskExportArtifact
>;

// Annotation, never assertion. `true as _GoalGuard` compiles even when the guard
// resolves to `never` — an assertion is legal whenever either type is assignable
// to the other, and `never` is assignable to everything. So the assertion form
// succeeds in exactly the case it is meant to catch. An annotation fails.
const _goalGuard: _GoalGuard = true;
const _taskGuard: _TaskGuard = true;
const _tagGuard: _TagGuard = true;
const _edgeGuard: _EdgeGuard = true;
const _folderGuard: _FolderGuard = true;
const _prototypeGuard: _PrototypeGuard = true;
const _documentGuard: _DocumentGuard = true;
const _noteGuard: _NoteGuard = true;
const _commentGuard: _CommentGuard = true;
const _agentRunGuard: _AgentRunGuard = true;
const _fileGuard: _FileGuard = true;
const _artifactGuard: _ArtifactGuard = true;

void _goalGuard;
void _taskGuard;
void _tagGuard;
void _edgeGuard;
void _folderGuard;
void _prototypeGuard;
void _documentGuard;
void _noteGuard;
void _commentGuard;
void _agentRunGuard;
void _fileGuard;
void _artifactGuard;
