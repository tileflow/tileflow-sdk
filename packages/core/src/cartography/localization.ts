import type {TileflowLabelLanguage} from '../types';
import type {TileflowDomainCompileContext} from './context';
import {nameField} from './semantic-bindings';
import {expression} from './values';

/** Resolve the shared language policy for every label-bearing cartographic domain. */
export function labelField(language: TileflowLabelLanguage, context: TileflowDomainCompileContext) {
  return expression<string>(labelFieldExpression(language, context));
}

/**
 * Prefer the requested translation, then the local name. `auto` resolves the renderer's
 * locale at evaluation time, so a compiled artifact never captures the build machine's language.
 * Latin and English names are last resorts when the source has no local name either.
 */
export function labelFieldExpression(
  language: TileflowLabelLanguage,
  context: TileflowDomainCompileContext,
): readonly unknown[] {
  const fields = context.data.schema.fields;
  const fallback = [fields.name, fields.nameLatin, fields.nameEn].map((name) => ['get', name]);
  if (language === 'local') {
    return firstNonempty(fallback);
  }
  if (language === 'auto') {
    const locale = ['var', 'labelLocale'];
    const base = ['slice', locale, 0, ['index-of', '-', ['concat', locale, '-']]];
    const translated = (suffix: unknown) => [
      'case',
      ['==', suffix, 'en'],
      ['get', fields.nameEn],
      ['get', ['concat', context.data.schema.nameLanguagePrefix, suffix]],
    ];
    return [
      'let',
      'labelLocale',
      ['resolved-locale', ['collator', {}]],
      firstNonempty([
        translated(locale),
        // World keeps Chinese script variants; regional browser locales select the script.
        translated([
          'case',
          [
            'any',
            ['in', '-Hant', locale],
            ['in', locale, ['literal', ['zh-TW', 'zh-HK', 'zh-MO']]],
          ],
          'zh-Hant',
          ['any', ['in', '-Hans', locale], ['in', locale, ['literal', ['zh-CN', 'zh-SG']]]],
          'zh-Hans',
          base,
        ]),
        ['case', ['==', base, 'en'], ['get', fields.nameEn], translated(base)],
        ...fallback,
      ]),
    ];
  }
  const locale = new Intl.Locale(language).baseName;
  const parts = locale.split('-');
  const languages = [locale];
  if (parts[0] === 'zh' && !parts.includes('Hans') && !parts.includes('Hant')) {
    if (parts.some((part) => ['TW', 'HK', 'MO'].includes(part))) languages.push('zh-Hant');
    if (parts.some((part) => ['CN', 'SG'].includes(part))) languages.push('zh-Hans');
  }
  while (parts.length > 1) {
    parts.pop();
    languages.push(parts.join('-'));
  }
  return firstNonempty([
    ...[...new Set(languages)].map((code) => [
      'get',
      code === 'en' ? fields.nameEn : nameField(code),
    ]),
    ...fallback,
  ]);
}

function firstNonempty(values: readonly unknown[]): readonly unknown[] {
  return [
    'case',
    ...values.flatMap((value) => [
      ['!=', ['coalesce', value, ''], ''],
      ['to-string', value],
    ]),
    '',
  ];
}
