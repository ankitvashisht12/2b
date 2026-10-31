import fs from 'node:fs';
import path from 'node:path';
import { ObjectStore } from './store.ts';
import { writeBody, vaultRoot } from './files.ts';
import type { ObjectRecord } from './models.ts';

/** Applies the reviewed backfill structure to V3 metadata only. */
export async function organizeImportedVault(rootInput: string) {
  const root = vaultRoot(rootInput), store = await ObjectStore.open(root);
  try {
    const objects = await store.list();
    const projects = objects.filter(object => object.type === 'project');
    const relationships = await store.relationships();
    const bySlug = (slug: string) => projects.find(object => object.properties.sourceVault === 'legacy' && object.properties.sourcePath === `projects/${slug}/readme.md`);
    const retired = new Set(['code-reviews', 'personal-research', 'work-misc']);
    const finite = new Set(['code-reviews', 'personal-research', 'work-misc']);
    for (const project of projects) {
      const slug = String(project.properties.sourcePath || '').match(/^projects\/([^/]+)\/readme\.md$/)?.[1];
      const properties = {
        ...project.properties,
        kind: project.properties.kind || (slug && finite.has(slug) ? 'finite' : 'ongoing'),
        status: slug && retired.has(slug) ? 'archived' : project.properties.status || 'active',
        priority: project.properties.priority || (project.name === 'Work planning' ? 'P4' : 'P3'),
        organizationProvenance: 'Reviewed V3 backfill plan: ongoing homes, finite outcomes, legacy reference archives',
      };
      const names: Record<string, string> = { 'personal content': 'Personal content', 'tars content': 'Tars content', travel: 'Travel', home: 'Home' };
      await store.upsert({ ...project, name: names[project.name] || project.name, properties });
    }
    const collections: Record<string, ObjectRecord> = {};
    async function collection(projectSlug: string, slug: string, name: string, description: string) {
      const id = `v3-collection:${projectSlug}:${slug}`;
      const project = bySlug(projectSlug);
      let record = objects.find(object => object.type === 'collection' && !object.properties.archived && object.id !== id && object.name.toLowerCase() === name.toLowerCase() && relationships.some(edge => edge.from === object.id && edge.to === project?.id && edge.kind === 'part-of')) || await store.get(id);
      const duplicate = record?.id !== id ? await store.get(id) : null;
      if (duplicate && record) {
        for (const edge of relationships.filter(edge => edge.from === duplicate.id || edge.to === duplicate.id)) {
          if (edge.to === duplicate.id) await store.relate(edge.from, edge.kind, record.id, edge.properties);
          await store.removeRelationship(edge.id);
        }
        let retiredPath = duplicate.path;
        if (retiredPath) {
          const retired = `migration/retired-generated/${slug}.md`;
          fs.mkdirSync(path.dirname(path.join(root, retired)), { recursive: true });
          if (fs.existsSync(path.join(root, retiredPath))) fs.renameSync(path.join(root, retiredPath), path.join(root, retired));
          retiredPath = retired;
        }
        await store.upsert({ ...duplicate, path: retiredPath, properties: { ...duplicate.properties, archived: true, redirectTo: record.id } });
      }
      if (!record) {
        const now = new Date().toISOString();
        record = await store.upsert({ id, type: 'collection', name, description, properties: { processingState: 'processed', organizationProvenance: 'Reviewed V3 backfill plan' }, tags: project?.tags || [], path: `collections/${projectSlug}/${slug}.md`, createdAt: now, modifiedAt: now });
        record = await writeBody(root, store, record, `# ${name}\n\n${description}\n`);
      }
      if (project) await store.relate(record.id, 'part-of', project.id, { provenance: 'reviewed-v3-organization' });
      collections[slug] = record;
      return record;
    }
    await collection('dev-environment', 'review-library', 'Review library', 'Index of completed code reviews. The original tasks retain their evidence and history. New feature reviews belong with the feature they support.');
    await collection('gym-and-health', 'nutrition', 'Nutrition', 'Diet plans and nutrition research. Historical plans keep their original dates; they do not replace the current health goal.');
    for (const object of objects) {
      const source = String(object.properties.sourcePath || '');
      if (source.startsWith('inbox/') && object.properties.processingState === 'imported') await store.upsert({ ...object, properties: { ...object.properties, processingState: 'inbox', inboxMigrationReviewed: false } });
      if (object.properties.sourceVault !== 'legacy') continue;
      const destination = source.startsWith('projects/code-reviews/tasks/') && object.type === 'task' ? collections['review-library']
        : source.startsWith('projects/personal-research/tasks/') && object.type === 'task' ? collections.nutrition : null;
      if (destination) await store.relate(object.id, 'part-of', destination.id, { provenance: 'reviewed-v3-organization' });
    }
    for (const edge of relationships) {
      if (edge.properties?.provenance !== 'planning-path') continue;
      const member = objects.find(object => object.id === edge.from);
      if (!member?.properties.sourcePath) continue;
      const source = String(member.properties.sourcePath);
      const workPlanning = member.properties.sourceVault === 'legacy' ? /^projects\/(?:goals|weekly-updates|product-updates)(?:\/|$)/.test(source) : /^work\/(?:monthly-goals|updates|weekly-updates|product-updates)(?:\/|$)/.test(source);
      if (!workPlanning) await store.removeRelationship(edge.id);
    }
    const current = await store.list();
    const startId = 'v3-start-here';
    let start = await store.get(startId);
    if (!start) {
      const now = new Date().toISOString();
      start = await store.upsert({ id: startId, type: 'note', name: 'Start here', description: 'Your copied vault and object system.', properties: { noteType: 'general', processingState: 'processed', systemGenerated: true }, tags: [], path: 'Start here.md', createdAt: now, modifiedAt: now });
    }
    const openProjects = current.filter(object => object.type === 'project' && !['done', 'archived'].includes(String(object.properties.status)));
    const lines = ['# Start here', '', 'This is the V3 copy. The original personal and 2b vaults remain separate and unchanged.', '', '## Project homes', '', ...openProjects.filter(object => object.path).map(object => `- [[${object.path!.replace(/\.md$/, '')}|${object.name}]]`), '', '## Reading the vault', '', '- Objects have readable files under objects/. Projects and collections connect related material.', '- Original bytes are preserved under archive/ until `2b tidy` moves the vault to plain pages; then artifacts open from the original vaults.', '- People, books, and reusable notes can exist without a project.', '- Tags have a name and context in 2b; they do not require a page.', '- Read metadata and manage tasks through the local dashboard or the 2b3 CLI.', '- The database and app settings live under ~/.2b. Back up both this vault and its matching database.', '', '## Migration evidence', '', 'The migration folder contains before/after source hashes, path maps, conflict records, and unresolved reference candidates. Imported jobs are disabled until reviewed.', ''];
    await writeBody(root, store, start, lines.join('\n'));
    return { projects: projects.length, collections: Object.values(collections).map(object => object.name), startPage: start.path, retiredSourceProjects: [...retired] };
  } finally { await store.close(); }
}
