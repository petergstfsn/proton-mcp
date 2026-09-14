import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function privateDirectory(path: string): Promise<void> {
  const entry = await lstat(path);
  if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error("Output parent must be a real directory.");
  // A different OS principal must not be able to replace parent components
  // between validation and rename. Processes with our own UID already own
  // the credentials and are outside this filesystem isolation boundary.
  if (process.platform !== "win32" && ((entry.mode & 0o022) !== 0 || entry.uid !== process.getuid?.())) {
    throw new Error("Output directories must be owned by the current user and not writable by other users.");
  }
}

async function trustedAncestor(path: string): Promise<void> {
  const entry = await lstat(path);
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("Output ancestor must be a real directory.");
  if (process.platform !== "win32" && (
    (entry.uid !== 0 && entry.uid !== process.getuid?.()) ||
    ((entry.mode & 0o022) !== 0 && (entry.mode & 0o1000) === 0)
  )) throw new Error("Output ancestors must not be replaceable by other users.");
}

async function prepareRoot(root: string): Promise<string> {
  let current = parse(root).root;
  await trustedAncestor(current);
  for (const part of relative(current, root).split(sep).filter(Boolean)) {
    current = join(current, part);
    try { await mkdir(current, { mode: 0o700 }); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const entry = await lstat(current);
    if (entry.isSymbolicLink()) {
      // Trusted system aliases (for example macOS /tmp) are supported, but
      // an attacker-owned link under a sticky directory is never followed.
      if (process.platform !== "win32" && entry.uid !== 0 && entry.uid !== process.getuid?.()) {
        throw new Error("Output ancestor symlink must be owned by the current user or system.");
      }
      current = await realpath(current);
      let ancestor = parse(current).root;
      await trustedAncestor(ancestor);
      for (const component of relative(ancestor, current).split(sep).filter(Boolean)) {
        ancestor = join(ancestor, component);
        await trustedAncestor(ancestor);
      }
    } else {
      await trustedAncestor(current);
    }
  }
  await privateDirectory(current);
  return current;
}

export async function preparePrivateOutput(root: string, target: string): Promise<string> {
  const absoluteRoot = resolve(root);
  const absoluteTarget = resolve(target);
  const realRoot = await prepareRoot(absoluteRoot);
  const lexicalRoot = inside(absoluteRoot, absoluteTarget) ? absoluteRoot : realRoot;
  if (!inside(lexicalRoot, absoluteTarget) || lexicalRoot === absoluteTarget) {
    throw new Error("Output path escapes the allowed directory or names the directory itself.");
  }
  await privateDirectory(realRoot);
  let parent = realRoot;
  const parts = relative(lexicalRoot, dirname(absoluteTarget)).split(sep).filter(Boolean);
  for (const part of parts) {
    parent = join(parent, part);
    try { await mkdir(parent, { mode: 0o700 }); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    await privateDirectory(parent);
  }
  const result = join(parent, basename(absoluteTarget));
  try {
    const entry = await lstat(result);
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("Output destination must be a regular file, not a symlink.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return result;
}

// Atomic replacement never follows a destination symlink or modifies an
// existing hardlink's inode. The temporary file is private from creation.
export async function writePrivateFile(root: string, target: string, content: string | Buffer): Promise<string> {
  const output = await preparePrivateOutput(root, target);
  const temp = join(dirname(output), `.${basename(output)}.${randomUUID()}.tmp`);
  const handle = await open(temp, "wx", 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    await preparePrivateOutput(root, target);
    await rename(temp, output);
    return output;
  } finally {
    await handle.close().catch(() => {});
    await unlink(temp).catch(() => {});
  }
}
