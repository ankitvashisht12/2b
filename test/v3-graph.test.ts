import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectGraph, type GraphOptions, type GraphSource } from '../dash-v3/src/lib/graph-data.ts';

type Scope = 'work' | 'personal' | 'both' | null;
function source(items: Array<[string, string, Scope]>, relations: Array<[string, string, string?]>): GraphSource {
  const list = items.map(([id, type]) => ({ id, type, name: id.toUpperCase() }));
  return {
    items: list,
    relationships: relations.map(([from, to, kind = 'links-to']) => ({ from, to, kind })),
    byId: new Map(list.map(item => [item.id, item])),
    scopeOf: new Map(items.map(([id, , scope]) => [id, scope])),
  };
}
const defaults: GraphOptions = { scope: 'all', tags: false, files: false, isBulk: item => item.type === 'evidence', limit: 1000 };
const ids = (nodes: Array<{ id: string }>) => nodes.map(node => node.id).sort();

const vault = source(
  [['w1', 'task', 'work'], ['w2', 'note', 'work'], ['p1', 'note', 'personal'], ['b1', 'project', 'both'], ['tag', 'tag', null], ['log', 'evidence', 'work'], ['alone', 'note', 'work']],
  [['w1', 'w2'], ['w2', 'w1', 'mentions'], ['w1', 'p1'], ['p1', 'b1'], ['w2', 'b1'], ['w1', 'tag', 'tagged-with'], ['w2', 'tag', 'tagged-with'], ['log', 'w1', 'part-of'], ['w1', 'w1']],
);

test('overview leaves out tags, bulk files, self links, and items with no link', () => {
  const graph = selectGraph(vault, defaults);
  assert.deepEqual(ids(graph.nodes), ['b1', 'p1', 'w1', 'w2']);
  assert.equal(graph.links.length, 4, 'w1-w2 is one link in either direction');
  assert.equal(graph.total, 4);
  assert.equal(graph.totalLinks, 4);
});

test('a scope keeps a link only when both ends are in it', () => {
  const work = selectGraph(vault, { ...defaults, scope: 'work' });
  assert.deepEqual(ids(work.nodes), ['b1', 'w1', 'w2']);
  assert.ok(work.links.every(link => link.source !== 'p1' && link.target !== 'p1'));
  const personal = selectGraph(vault, { ...defaults, scope: 'personal' });
  assert.deepEqual(ids(personal.nodes), ['b1', 'p1']);
});

test('tags and files show only when asked', () => {
  assert.deepEqual(ids(selectGraph(vault, { ...defaults, tags: true, files: true }).nodes), ['b1', 'log', 'p1', 'tag', 'w1', 'w2']);
});

test('a limit keeps the best-linked items and says the total', () => {
  const graph = selectGraph(vault, { ...defaults, limit: 2 });
  assert.equal(graph.total, 4);
  assert.deepEqual(ids(graph.nodes), ['b1', 'p1'], 'equal degree: a stable order');
  assert.equal(graph.links.length, 1);
});

test('a local graph shows the focus, its neighbours, and links between neighbours', () => {
  const graph = selectGraph(vault, { ...defaults, focusId: 'w1' });
  assert.deepEqual(ids(graph.nodes), ['p1', 'w1', 'w2']);
  assert.equal(graph.hiddenNeighbors, 2, 'the tag and the log file');
  const tagGraph = selectGraph(vault, { ...defaults, focusId: 'tag' });
  assert.deepEqual(ids(tagGraph.nodes), ['tag', 'w1', 'w2'], 'a tag shows its tagged items');
  assert.equal(selectGraph(vault, { ...defaults, focusId: 'alone' }).nodes.length, 0);
});

test('a star with thousands of links stays bounded and fast', () => {
  const items: Array<[string, string, Scope]> = [['hub', 'task', 'work']];
  const relations: Array<[string, string]> = [];
  for (let index = 0; index < 2500; index++) {
    items.push(['n' + index, 'note', index % 2 ? 'work' : 'personal']);
    relations.push(['n' + index, 'hub']);
    if (index) relations.push(['n' + index, 'n' + (index - 1)]);
  }
  const star = source(items, relations);
  const started = performance.now();
  const graph = selectGraph(star, { ...defaults, focusId: 'hub', limit: 300 });
  assert.ok(performance.now() - started < 200);
  assert.equal(graph.total, 2501);
  assert.equal(graph.nodes.length, 300);
  assert.equal(graph.nodes[0].id, 'hub');
  assert.equal(selectGraph(star, { ...defaults, focusId: 'hub', scope: 'work', limit: Infinity }).nodes.length, 1251);
});
