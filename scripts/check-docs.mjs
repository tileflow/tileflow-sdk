import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {publicPackageCatalog} from './release-config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const repositoryUrl = 'https://github.com/tileflow/tileflow-sdk/';

export function parseMarkdown(content, label = 'Markdown') {
  const blocks = [];
  const headings = [];
  const prose = [];
  let fence;
  let marked = false;
  const lines = content.split(/\r?\n/u);
  for (const [index, line] of lines.entries()) {
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (fence) {
      if (
        delimiter &&
        delimiter[1][0] === fence.delimiter[0] &&
        delimiter[1].length >= fence.delimiter.length &&
        !delimiter[2].trim()
      ) {
        blocks.push({...fence, code: fence.lines.join('\n')});
        fence = undefined;
      } else {
        fence.lines.push(line);
      }
      continue;
    }
    if (delimiter) {
      const language = delimiter[2].trim();
      assert.match(
        language,
        /^[a-z][a-z0-9+-]*$/u,
        `${label}:${index + 1}: name the fence language`,
      );
      fence = {delimiter: delimiter[1], language, marked, line: index + 2, lines: []};
      marked = false;
      continue;
    }
    if (line.trim() === '<!-- docs:check -->') {
      assert.ok(!marked, `${label}:${index + 1}: duplicate example marker`);
      marked = true;
      continue;
    }
    assert.ok(
      !marked || !line.trim(),
      `${label}:${index + 1}: example marker must precede a fence`,
    );
    const heading = /^(#{1,6}) (.+)$/u.exec(line);
    if (heading) headings.push({level: heading[1].length, text: heading[2]});
    prose.push(line);
  }
  assert.ok(!fence, `${label}: unclosed code fence`);
  assert.ok(!marked, `${label}: example marker has no example`);
  return {blocks, headings, prose: prose.join('\n')};
}

export function localLinkTarget(url, source, directory = root) {
  if (url.startsWith('#')) return undefined;
  let path = url.split(/[?#]/u)[0];
  const githubPrefix = `${repositoryUrl}blob/main/`;
  const treePrefix = `${repositoryUrl}tree/main/`;
  const rawPrefix = 'https://raw.githubusercontent.com/tileflow/tileflow-sdk/main/';
  const prefix = [githubPrefix, treePrefix, rawPrefix].find((candidate) =>
    path.startsWith(candidate),
  );
  if (prefix) return resolve(directory, decodeURIComponent(path.slice(prefix.length)));
  if (/^[a-z][a-z0-9+.-]*:/iu.test(path)) return undefined;
  path = decodeURIComponent(path);
  assert.ok(!path.startsWith('/'), `${source}: avoid host-relative documentation links: ${url}`);
  return resolve(dirname(source), path);
}

async function markdownFiles(directory) {
  if (!existsSync(directory)) return [];
  const result = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await markdownFiles(path)));
    else if (entry.name.endsWith('.md')) result.push(path);
  }
  return result.sort();
}

async function documents() {
  const result = ['README.md', 'llms.txt', 'docs/documentation.md'].map((path) => ({
    path: join(root, path),
    directory: 'cli',
  }));
  for (const entry of publicPackageCatalog) {
    const directory = join(root, 'packages', entry.directory);
    result.push({path: join(directory, 'README.md'), ...entry, readme: true});
    for (const path of await markdownFiles(join(directory, 'docs'))) {
      result.push({path, directory: entry.directory});
    }
  }
  return result;
}

async function checkPackaging(entry) {
  const directory = join(root, 'packages', entry.directory);
  const output = execFileSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['pack', '--dry-run', '--ignore-scripts', '--json', '.'],
    {cwd: directory, encoding: 'utf8', timeout: 30000, shell: process.platform === 'win32'},
  );
  const packed = new Set(JSON.parse(output)[0].files.map((file) => file.path));
  assert.ok(packed.has('README.md'), `${entry.name}: README.md is missing from the pack list`);
  for (const path of await markdownFiles(join(directory, 'docs'))) {
    const name = relative(directory, path).replaceAll('\\', '/');
    assert.ok(packed.has(name), `${entry.name}: ${name} is missing from the pack list`);
  }
}

function declarationTarget(value) {
  if (typeof value === 'string') return value.endsWith('.d.ts') ? value : undefined;
  if (!value || typeof value !== 'object') return undefined;
  if (typeof value.types === 'string') return value.types;
  for (const child of Object.values(value)) {
    const result = declarationTarget(child);
    if (result) return result;
  }
  return undefined;
}

async function checkExamples(allDocuments) {
  const {default: ts} = await import('typescript');
  const paths = {};
  for (const entry of publicPackageCatalog) {
    const directory = join(root, 'packages', entry.directory);
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    for (const [subpath, value] of Object.entries(manifest.exports ?? {})) {
      const target = declarationTarget(value);
      if (!target) continue;
      const path = resolve(directory, target);
      assert.ok(existsSync(path), `${entry.name}: run pnpm build before docs:check (${target})`);
      paths[`${entry.name}${subpath === '.' ? '' : subpath.slice(1)}`] = [path];
    }
  }
  const reactTypes = join(root, 'packages/react/node_modules/@types/react');
  paths.react = [join(reactTypes, 'index.d.ts')];
  paths['react/jsx-runtime'] = [join(reactTypes, 'jsx-runtime.d.ts')];
  const temporary = [];
  const files = [];
  const labels = new Map();
  let frameworkCount = 0;
  try {
    for (const document of allDocuments) {
      const blocks = document.markdown.blocks;
      for (const [index, block] of blocks.entries()) {
        let code = block.code;
        let extension = {ts: 'ts', tsx: 'tsx', js: 'mjs'}[block.language];
        const label = `${relative(root, document.path)}:${block.line}`;
        if (block.language === 'vue' && document.readme) {
          const require = createRequire(join(root, 'packages/vue/package.json'));
          const compiler = require('vue/compiler-sfc');
          const {descriptor, errors} = compiler.parse(code, {filename: `${index}.vue`});
          assert.deepEqual(errors, [], `${label}: invalid Vue component`);
          const script = compiler.compileScript(descriptor, {id: `readme-${index}`});
          if (descriptor.template) {
            const template = compiler.compileTemplate({
              source: descriptor.template.content,
              filename: `${index}.vue`,
              id: `readme-${index}`,
              compilerOptions: {bindingMetadata: script.bindings},
            });
            assert.deepEqual(template.errors, [], `${label}: invalid Vue template`);
          }
          code =
            (descriptor.script?.content ?? '') + '\n' + (descriptor.scriptSetup?.content ?? '');
          extension = 'ts';
          frameworkCount++;
        } else if (block.language === 'svelte' && document.readme) {
          const require = createRequire(join(root, 'packages/svelte/package.json'));
          const compiler = require('svelte/compiler');
          compiler.compile(code, {filename: `${index}.svelte`, generate: 'client'});
          code =
            '/// <reference types="svelte" />\n' +
            (/<script[^>]*>([\s\S]*?)<\/script>/u.exec(code)?.[1] ?? '');
          extension = 'ts';
          frameworkCount++;
        } else if (!block.marked) {
          continue;
        }
        assert.ok(extension, `${label}: docs:check supports ts, tsx, and js examples`);
        const directory = await mkdtemp(
          join(root, 'packages', document.directory, '.readme-check-'),
        );
        temporary.push(directory);
        const path = join(directory, `example.${extension}`);
        await writeFile(path, `${code}\nexport {};\n`);
        files.push(path);
        labels.set(path, label);
      }
    }
    const options = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.ReactJSX,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      allowJs: true,
      checkJs: true,
      allowSyntheticDefaultImports: true,
      esModuleInterop: true,
      paths,
    };
    const program = ts.createProgram(files, options);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    for (const diagnostic of diagnostics) {
      const path = diagnostic.file?.fileName;
      const line = diagnostic.file?.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line;
      console.error(
        `${labels.get(path) ?? path ?? 'Examples'} (example line ${(line ?? 0) + 1}): ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`,
      );
    }
    assert.equal(
      diagnostics.length,
      0,
      'README examples must typecheck against public package exports',
    );
    console.log(
      `Checked ${files.length} example modules and compiled ${frameworkCount} framework components.`,
    );
  } finally {
    for (const directory of temporary) await rm(directory, {recursive: true, force: true});
  }
}

export async function checkDocs({structureOnly = false} = {}) {
  const allDocuments = await documents();
  for (const document of allDocuments) {
    const content = await readFile(document.path, 'utf8');
    const label = relative(root, document.path);
    const markdown = parseMarkdown(content, label);
    document.markdown = markdown;
    assert.ok(
      content.length <= (document.readme ? 20000 : 50000),
      `${label}: split this page into focused guides`,
    );
    if (document.readme) {
      assert.equal(
        markdown.headings.filter((heading) => heading.level === 1).length,
        1,
        `${label}: use one title`,
      );
      assert.equal(
        markdown.headings[0]?.text,
        document.name,
        `${label}: title must match the package name`,
      );
      assert.ok(
        markdown.headings.some((heading) => heading.text === 'Install'),
        `${label}: add installation prerequisites`,
      );
      assert.ok(
        content.includes(`${document.name}@alpha`),
        `${label}: show the explicit installation channel`,
      );
      assert.ok(
        markdown.blocks.some((block) => block.marked),
        `${label}: include a checked example`,
      );
    }
    for (const match of markdown.prose.matchAll(/\[[^\]\n]*\]\(([^\s)]+)\)/gu)) {
      const target = localLinkTarget(match[1], document.path);
      if (target) assert.ok(existsSync(target), `${label}: broken repository link ${match[1]}`);
    }
  }
  const index = await readFile(join(root, 'llms.txt'), 'utf8');
  for (const entry of publicPackageCatalog) {
    assert.ok(
      index.includes(`/packages/${entry.directory}/README.md`),
      `llms.txt: missing ${entry.name}`,
    );
    await checkPackaging(entry);
  }
  console.log(
    `Checked ${allDocuments.length} documentation files and ${publicPackageCatalog.length} package pack lists.`,
  );
  if (!structureOnly) await checkExamples(allDocuments);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await checkDocs({structureOnly: process.argv.includes('--structure-only')});
}
