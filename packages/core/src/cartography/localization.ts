import type {TileflowLabelLanguage} from '../types';
import type {TileflowDomainCompileContext} from './context';
import {expression} from './values';

/** Resolve the shared language policy for every label-bearing cartographic domain. */
export function labelField(language: TileflowLabelLanguage, context: TileflowDomainCompileContext) {
  return expression<string>(labelFieldExpression(language, context));
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
