import type {TileflowLabelLanguage} from '../types';
import type {TileflowDomainCompileContext} from './context';
import {expression} from './values';

/** Resolve the shared language policy for every label-bearing cartographic domain. */
export function labelField(language: TileflowLabelLanguage, context: TileflowDomainCompileContext) {
  return expression<string>(labelFieldExpression(language, context));
}

/** The source fields a label can take its name from, in the order the label prefers them. */
export function labelNameFields(
  language: TileflowLabelLanguage,
  context: TileflowDomainCompileContext,
): string[] {
  return labelFieldExpression(language, context)
    .slice(1)
    .map((entry) => (entry as readonly [string, string])[1]);
}

export function labelFieldExpression(
  language: TileflowLabelLanguage,
  context: TileflowDomainCompileContext,
): readonly unknown[] {
  const fields = context.data.schema.fields;
  if (language === 'local') {
    return [
      'coalesce',
      ['get', fields.name],
      ['get', fields.nameLatin],
      ['get', fields.nameEnglish],
    ];
  }
  if (language === 'auto') {
    return [
      'coalesce',
      ['get', fields.nameLatin],
      ['get', fields.name],
      ['get', fields.nameEnglish],
    ];
  }
  const requestedField = language === 'en' ? fields.nameEnglish : `name:${language}`;
  return ['coalesce', ['get', requestedField], ['get', fields.nameLatin], ['get', fields.name]];
}
