import {
  getArtifact,
  getFile,
  getProject,
  getRenderTokenByHash,
  getShareByTokenHash,
  hashRenderToken,
  hashShareToken,
  isRenderToken,
  parseRenderTokenPrototypeIds,
  resolveLibrary,
  type Db,
  type Share,
  type SharePolicy,
} from '@plandesk/db';

export type FrameCredentialKind = 'share' | 'render';

export type FrameCredential = {
  kind: FrameCredentialKind;
  orgId: string;
  projectId: string;
  prototypeIds: string[];
  /** Raw token to embed in rewritten subresource URLs. */
  rawToken: string;
};

function parseSharePolicy(share: Share): SharePolicy {
  const parsed: unknown = JSON.parse(share.policy);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { tasks: [], documentIds: [], prototypeIds: [], fields: {} };
  }
  const policy = parsed as Partial<SharePolicy>;
  return {
    tasks: policy.tasks ?? [],
    documentIds: policy.documentIds ?? [],
    prototypeIds: policy.prototypeIds ?? [],
    fields: policy.fields ?? {},
  };
}

/**
 * One verification point for render + file routes: a share whose policy covers
 * the prototype, or a render token scoped to it. Expired / revoked tokens are
 * absent from the lookup helpers — same behaviour as a missing credential.
 *
 * Org isolation: a token is bound to its orgId + projectId at mint time. Org A
 * cannot obtain a token that lists org B's prototypes because mint requires
 * project membership in the caller's org; verification then refuses cross-org
 * artifact/file ids even if guessed.
 */
export async function verifyFrameCredential(
  db: Db,
  rawToken: string,
): Promise<FrameCredential | undefined> {
  if (rawToken.trim() === '') {
    return undefined;
  }

  if (isRenderToken(rawToken)) {
    const row = await getRenderTokenByHash(db, hashRenderToken(rawToken));
    if (!row) {
      return undefined;
    }
    return {
      kind: 'render',
      orgId: row.orgId,
      projectId: row.projectId,
      prototypeIds: parseRenderTokenPrototypeIds(row),
      rawToken,
    };
  }

  // Share capability URL (plandesk_share_…)
  const share = await getShareByTokenHash(db, hashShareToken(rawToken));
  if (!share || share.projectId === null) {
    return undefined;
  }
  const policy = parseSharePolicy(share);
  const project = await getProject(db, share.projectId);
  if (!project) {
    return undefined;
  }
  return {
    kind: 'share',
    orgId: project.orgId,
    projectId: share.projectId,
    prototypeIds: policy.prototypeIds ?? [],
    rawToken,
  };
}

export function credentialCoversPrototype(
  credential: FrameCredential,
  prototypeId: string | null,
): boolean {
  if (prototypeId === null) {
    return false;
  }
  return credential.prototypeIds.includes(prototypeId);
}

export async function artifactAuthorizedByCredential(
  db: Db,
  credential: FrameCredential,
  artifactId: string,
): Promise<{ id: string; projectId: string; prototypeId: string | null; content: string; kind: string; title: string } | undefined> {
  const artifact = await getArtifact(db, artifactId);
  if (!artifact) {
    return undefined;
  }
  if (artifact.projectId !== credential.projectId) {
    return undefined;
  }
  if (!credentialCoversPrototype(credential, artifact.prototypeId)) {
    return undefined;
  }
  return artifact;
}

export async function fileAuthorizedByCredential(
  db: Db,
  credential: FrameCredential,
  fileId: string,
): Promise<{ projectId: string } | undefined> {
  const file = await getFile(db, credential.projectId, fileId);
  if (!file) {
    return undefined;
  }
  // Token already scoped to project; any file in that project is reachable
  // when the credential is valid. Cross-project ids 404 via getFile.
  return { projectId: file.projectId };
}

const FILE_SCHEME = /plandesk:\/\/file\/([A-Za-z0-9_-]+)/g;
const LIB_SCHEME = /plandesk:\/\/lib\/([A-Za-z0-9@._-]+)/g;

/**
 * Rewrite plandesk://file/ and plandesk://lib/ refs into token-carrying absolute
 * URLs. Substitutes the scheme only — does not parse surrounding markup.
 */
export async function rewriteFrameResourceRefs(
  db: Db,
  content: string,
  origin: string,
  credential: FrameCredential,
): Promise<string> {
  const tokenQ = `token=${encodeURIComponent(credential.rawToken)}`;
  let out = content.replace(FILE_SCHEME, (_m, id: string) => {
    return `${origin}/api/v1/files/${id}?${tokenQ}`;
  });

  const libRefs = new Set<string>();
  out.replace(LIB_SCHEME, (_m, ref: string) => {
    libRefs.add(ref);
    return _m;
  });

  for (const ref of libRefs) {
    const resolved = await resolveLibrary(db, `plandesk://lib/${ref}`, credential.projectId);
    if (resolved === null) {
      continue;
    }
    const target = `${origin}/api/v1/files/${resolved.fileId}?${tokenQ}`;
    out = out.split(`plandesk://lib/${ref}`).join(target);
  }

  return out;
}
