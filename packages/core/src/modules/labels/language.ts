import type {TileflowDomainCompileContext} from '../../cartography/context';
import {expression} from '../../cartography/values';
import type {TileflowLabelLanguage} from '../../types';

/** Resolve one language policy for every label-bearing Streets domain. */
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
