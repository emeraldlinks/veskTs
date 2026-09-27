/**
 * Same-name component declarations across `.vsk` files.
 *
 * `.vsk` components are not module-local bindings — every component a bundle
 * compiles is registered in ONE global registry under its declared name
 * (`__components["Helper"]`, `__registry.get("Helper")`). Two files that each
 * declare `component Helper` therefore land on the same key, and which one wins
 * depends on the order the bundle graph happened to walk. There is no type
 * error and no runtime error: the page just renders somebody else's component.
 *
 * That is the failure mode worth reporting. It is *not* the same as importing a
 * non-exported component: making `export` load-bearing would not prevent a
 * collision, because two files can both `export component Helper` and still
 * overwrite one key. So this check looks only at declaration names, never at
 * the registry (the registry holds no ownership metadata and cannot say which
 * file a symbol came from).
 *
 * Deliberately a WARNING, not an error. The loose name-keyed registry is
 * long-standing and load-bearing, and a hard error here would break builds that
 * render correctly today.
 */

export interface VskComponentCollision {
  name: string;
  files: string[];
}

export class VskComponentOwners {
  private owners = new Map<string, Set<string>>();

  /** Records that `file` declares a component called `name`. */
  claim(name: string, file: string): void {
    let set = this.owners.get(name);
    if (!set) {
      set = new Set();
      this.owners.set(name, set);
    }
    set.add(file);
  }

  /** Names declared by more than one file, each with its declaring files. */
  collisions(): VskComponentCollision[] {
    const out: VskComponentCollision[] = [];
    for (const [name, files] of this.owners) {
      if (files.size > 1) out.push({ name, files: [...files] });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Warns once per colliding name. Returns the message per collision so a
   * caller (or a test) can assert on the text without capturing stderr.
   *
   * Deduped by name for the life of the process: the SSR path compiles one
   * file graph per `compileFile` call, so without this a single build would
   * repeat the same warning once per entry page.
   */
  report(context: string): string[] {
    const collisions = this.collisions();
    const fresh: string[] = [];
    for (const { name, files } of collisions) {
      if (reportedCollisions.has(name)) continue;
      reportedCollisions.add(name);
      fresh.push(`${name}: ${files.join(', ')}`);
      console.warn(
        `[vesk] ${context}: component "${name}" is declared in ${files.length} files and resolves to only one of them — `
        + `${files.join(', ')}. Which one wins depends on compile order, and the client and server registries pick differently, `
        + `so this can render a different component in the browser than in the SSR HTML. Rename one of them.`,
      );
    }
    return fresh;
  }
}

/**
 * Names already warned about. The client bundle and the SSR path each compile
 * overlapping file graphs, so a per-instance set would double-report.
 */
const reportedCollisions = new Set<string>();

/** Test hook: forget which collisions have been reported. */
export function resetVskCollisionReports(): void {
  reportedCollisions.clear();
}
