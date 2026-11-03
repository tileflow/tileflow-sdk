import type {TileflowLabelLanguage} from '../types';
import type {TileflowDomainCompileContext} from './context';
import {nameField} from './semantic-bindings';
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

/**
 * A label's name in the requested language, then its Latin-script name, then its local name.
 * World publishes fewer languages below z12, where the label falls back to those names.
 */
export function labelFieldExpression(
  language: TileflowLabelLanguage,
  context: TileflowDomainCompileContext,
): readonly unknown[] {
  const fields = context.data.schema.fields;
  const english = nameField('en');
  if (language === 'local') {
    return ['coalesce', ['get', fields.name], ['get', fields.nameLatin], ['get', english]];
  }
  if (language === 'auto') {
    return ['coalesce', ['get', fields.nameLatin], ['get', fields.name], ['get', english]];
  }
  return [
    'coalesce',
    ['get', nameField(language)],
    ['get', fields.nameLatin],
    ['get', fields.name],
  ];
}
