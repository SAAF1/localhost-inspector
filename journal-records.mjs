import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { featureTemplateScope, sourceContextFrom } from './source-handoff.mjs'
import { colors, declaresVariable, journalTarget, targetFingerprint, templateFingerprint, textStyleProperties,
  validRoute, validScopedTarget, validTargetKey, validTextStyleValue, validValue, variableName } from './journal-values.mjs'

const buttonSizes = ['default', 'sm', 'lg', 'icon']
export function journalValidators(journalRoute) {
  function editFrom(record, catalog, group, pendingTextStyle) {
    const textStyle = record?.textStyleToken
    const token = record?.colorToken
    const spacing = record?.spacingToken
    const pending = record?.pendingColor
    const reference = token ?? spacing
    const validTextStyleRequest = group && !reference && !pending &&
      textStyleProperties.includes(record?.property) && (
        pendingTextStyle
          ? !Object.hasOwn(record, 'textStyleToken') &&
            record.requested === 'var(' + pendingTextStyle.name + '-' + record.property + ', ' + pendingTextStyle.values[record.property] + ')' &&
            record.observed === pendingTextStyle.values[record.property]
          : Object.hasOwn(record, 'textStyleToken')
            ? textStyle && catalog && textStyle.source === catalog.source && catalog.names.includes(textStyle.name) &&
              record.requested === 'var(' + textStyle.name + '-' + record.property + ')'
            : validTextStyleValue(record.property, record.requested)
      )
    const prepared = record?.prepared
    const field = prepared?.field
    if (prepared !== undefined) {
      const validSite = typeof prepared?.site === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(prepared.site) &&
        typeof prepared.revision === 'string' && /^[a-f0-9]{64}$/.test(prepared.revision) &&
        typeof prepared.file === 'string' && prepared.file.length <= 240 && /\.[jt]sx$/.test(prepared.file) &&
        !prepared.file.startsWith('/') && !prepared.file.split('/').includes('..')
      const validControl = field === undefined ? ['padding-left','padding-right','padding-top','padding-bottom','gap','width','height','min-width','min-height','max-width','max-height','font-weight','color','background-color'].includes(record.property) :
        typeof field === 'string' && /^[a-zA-Z][a-zA-Z0-9-]{0,59}$/.test(field) && record.property === 'component-' + field &&
        typeof record.requested === 'string' && /^[a-zA-Z0-9_-]{1,60}$/.test(record.requested) &&
        record.observed === record.requested && !reference
      if (!validSite || !validControl || group || pending || record.template || record.frameState ||
          record.restore !== 'unique' || record.intent !== featureTemplateScope) throw Error('Invalid prepared contract')
    }
    const validRequest = field ? true : group ? validTextStyleRequest : reference
      ? !(token && spacing) && catalog && (spacing ? /^(gap|padding-(top|right|bottom|left))$/.test(record.property) : colors.has(record.property)) &&
        reference.source === catalog.source && catalog.names.includes(reference.name) &&
        record.requested === 'var(' + reference.name + ')' &&
        (!spacing || /^(?:\d+\.?\d*|\.\d+)px$/.test(record.observed) && Number.parseFloat(record.observed) <= 2000)
      : validValue(record?.property, record?.requested)
    const validPending = !pending || (!reference && catalog && record.property === 'background-color' &&
      typeof pending.label === 'string' && /^[a-z][a-z0-9 -]{0,79}$/i.test(pending.label) &&
      typeof pending.name === 'string' && variableName.test(pending.name) &&
      pending.name === '--' + pending.label.toLowerCase().replace(/ +/g, '-') &&
      pending.source === catalog.source && pending.value === record.requested && pending.value === record.observed &&
      /^(?:rgba?\(|(?:oklch|oklab|lch|lab|color)\()/i.test(pending.value))
    const target = record?.target
    if (!record || !/^[a-f0-9-]{36}$/.test(record.id) || !validRoute(record.route) || !validRequest || !validPending ||
        Object.hasOwn(record, 'group') || (!group && Object.hasOwn(record, 'textStyleToken')) ||
        ((Object.hasOwn(record, 'pendingTextStyle') || Object.hasOwn(record, 'pendingTextStyleName')) && !pendingTextStyle) ||
        !(field || (group ? validTextStyleValue(record.property, record.observed) : validValue(record.property, record.observed))) ||
        typeof record.before !== 'string' || record.before.length > (record.property === 'font-family' ? 512 : 100) ||
        !['unique', 'ambiguous'].includes(record.restore) || !target || !/^[a-z][a-z0-9-]*$/.test(target.tag) ||
        !validScopedTarget(target) || !validTargetKey(target.key) || [target.id, target.slot].some(value => value !== null && (typeof value !== 'string' || value.length > 120)) ||
        (record.frameState !== undefined && !targetFingerprint(record.frameState)) ||
        (record.template !== undefined && (group || pending || record.frameState !== undefined ||
          record.restore !== 'unique' || record.intent !== featureTemplateScope ||
          typeof record.template !== 'string' || !/^[a-z0-9][a-z0-9._:/-]{0,119}$/i.test(record.template))) ||
        (record.templateSourceFingerprint !== undefined && (!record.template || !templateFingerprint(record.templateSourceFingerprint))) ||
        [target.textFingerprint, target.regionFingerprint, target.classFingerprint, target.contextFingerprint].some(value =>
          value !== undefined && !targetFingerprint(value))) {
      throw Error('Invalid edit record')
    }
    const { id, route, property, requested, observed, before, restore } = record
    // An older extension can still save previews, but only a current extension
    // explicitly signals the template intent expected by the new handoff.
    const intent = record.intent === featureTemplateScope ? featureTemplateScope : 'selected occurrence only'
    const sourceContext = intent === featureTemplateScope ? sourceContextFrom(record.sourceContext) : undefined
    const { width, height } = record.viewport ?? {}
    const viewport = Number.isInteger(width) && Number.isInteger(height) ? { width, height } : undefined
    const colorToken = token ? { source: token.source, name: token.name } : undefined
    const spacingToken = spacing ? { source: spacing.source, name: spacing.name } : undefined
    const pendingColor = pending ? { source: pending.source, name: pending.name, label: pending.label, value: pending.value } : undefined
    const textStyleToken = textStyle ? { source: textStyle.source, name: textStyle.name } : undefined
    return {
      id, route: journalRoute(route), property, requested, observed, before, restore,
      ...(prepared ? { prepared: { site: prepared.site, revision: prepared.revision, file: prepared.file, ...(field ? { field } : {}) } } : {}),
      target: journalTarget(target), viewport, frameState: record.frameState, template: record.template,
      templateSourceFingerprint: record.templateSourceFingerprint,
      colorToken, pendingColor, spacingToken, textStyleToken, group, intent, sourceContext,
    }
  }
  function groupedPaddingEdits(records, catalog, journal, shared) {
    if (!Array.isArray(records) || (shared ? records.length < 4 || records.length > 40 || records.length % 2 : records.length !== 2)) {
      throw Error('Invalid grouped padding operation')
    }
    const edits = records.map(record => editFrom(record, catalog))
    const first = edits[0]
    if(edits.some(edit=>edit.prepared) && (shared || edits.some(edit=>edit.prepared?.site!==first.prepared?.site || edit.prepared?.revision!==first.prepared?.revision || edit.prepared?.file!==first.prepared?.file)))throw Error('Padding sides must have the same prepared source.')
    const name = records[0].sharedPadding
    const horizontal = !shared && first.property === 'padding-left'
    const [firstSide, secondSide] = horizontal ? ['padding-left', 'padding-right'] : ['padding-top', 'padding-bottom']
    const keys = new Set()
    const ids = new Set(edits.map(edit => edit.id))
    if ((shared ? first.template || typeof name !== 'string' || !/^[a-z0-9_-]{1,80}$/i.test(name) : name !== undefined) ||
        ids.size !== edits.length || journal.edits.some(edit => ids.has(edit.id))) {
      throw Error('Invalid grouped padding operation')
    }
    for (let index = 0; index < edits.length; index += 2) {
      const [top, bottom] = edits.slice(index, index + 2)
      const { key, tag } = top.target
      if ((shared && (!key || keys.has(key))) || tag !== first.target.tag || top.property !== firstSide ||
        bottom.property !== secondSide || JSON.stringify(top.target) !== JSON.stringify(bottom.target) ||
        [top, bottom].some((entry, offset) => entry.template !== first.template || entry.route !== first.route || entry.requested !== first.requested ||
          Boolean(entry.spacingToken) !== Boolean(first.spacingToken) ||
          (shared && entry.restore !== 'unique') || entry.intent !== featureTemplateScope || records[index + offset].sharedPadding !== name)) {
        throw Error('Invalid grouped padding operation')
      }
      keys.add(key)
    }
    return edits.map(edit => ({ ...edit, group: first.id, sharedPadding: name }))
  }

  async function validateTextStyleDefinition(pending, catalog, journal) {
    if (!pending || typeof pending !== 'object') throw Error('Invalid new text style')
    const { name, label, description, source, values } = pending
    if (!catalog || source !== catalog.source ||
        typeof label !== 'string' || !/^[a-z][a-z0-9 -]{0,69}$/i.test(label) || label !== label.trim() ||
        name !== '--text-' + label.toLowerCase().replace(/ +/g, '-') ||
        typeof description !== 'string' || description.length > 240 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(description) ||
        !values || textStyleProperties.some(property => !validTextStyleValue(property, values[property]) ||
          (values[property].endsWith('px') && Math.abs(parseFloat(values[property])) > 2000))) {
      throw Error('Invalid new text style')
    }
    await access(catalog.file, constants.W_OK).catch(() => { throw Error('The text style source is read-only.') })
    if (catalog.names.includes(name) || declaresVariable(catalog.css, name) ||
        textStyleProperties.some(property => declaresVariable(catalog.css, name + '-' + property)) ||
        journal.edits.some(edit => edit.pendingTextStyle?.name === name) ||
        journal.textStyleDefinitions?.some(style => style.name === name)) {
      throw Error('That style name is already in use.')
    }
    return { name, label, description, source, values: Object.fromEntries(textStyleProperties.map(property => [property, values[property]])) }
  }
  async function textStyleEdits(records, catalog, journal) {
    if (!Array.isArray(records) || !records.length || records.length > 50 || !records[0]?.id) {
      throw Error('Expected 1 to 50 text style edits')
    }
    if (records.slice(1).some(record => record && (Object.hasOwn(record, 'pendingTextStyle') || Object.hasOwn(record, 'pendingTextStyleName')))) {
      throw Error('Expected one text style definition per edit group')
    }
    const [record] = records
    const reference = record.pendingTextStyleName
    if (reference !== undefined && (typeof reference !== 'string' || !validRoute(record.route) || record.pendingTextStyle)) {
      throw Error('Invalid pending text style reference')
    }
    const pending = reference === undefined
      ? record.pendingTextStyle && await validateTextStyleDefinition(record.pendingTextStyle, catalog, journal)
      : journal.textStyleDefinitions?.find(style => style.name === reference) ??
        journal.edits.find(edit => edit.route === journalRoute(record.route) && edit.pendingTextStyle?.name === reference)?.pendingTextStyle
    if (reference !== undefined && (!pending || pending.source !== catalog?.source || catalog.names.includes(reference))) {
      throw Error('This pending text style is unavailable.')
    }
    const edits = records.map(record => editFrom(record, catalog, records[0].id, pending))
    const [first] = edits
    const ids = new Set(edits.map(edit => edit.id))
    if (ids.size !== edits.length || journal.edits.some(edit => ids.has(edit.id)) ||
        edits.some(edit => edit.route !== first.route || edit.textStyleToken?.name !== first.textStyleToken?.name)) {
      throw Error('Text style edits must use unique IDs, one route and one style')
    }
    if (pending) {
      if ((reference === undefined && (edits.length !== textStyleProperties.length || edits.some(edit => edit.before !== edit.observed))) ||
          new Set(edits.map(edit => edit.property)).size !== edits.length ||
          edits.some(edit => JSON.stringify(edit.target) !== JSON.stringify(first.target) || edit.restore !== first.restore)) {
        throw Error('Expected one complete new style on one text layer')
      }
      if (reference === undefined) first.pendingTextStyle = pending
      else first.pendingTextStyleName = reference
    }
    return edits
  }
  function componentPropertyEdit(record) {
    const { id, route, beforeState, afterState, target, component } = record ?? {}
    const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value)
    const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max
    const state = value => {
      if (!value || typeof value !== 'object') return false
      const scalar = value.value === null || typeof value.value === 'boolean' || Number.isFinite(value.value) ||
        (typeof value.value === 'string' && value.value.length <= (target.kind === 'text' ? 16000 : 180))
      return scalar && (target.kind === 'source' ? typeof value.overridden === 'boolean' : typeof value.visible === 'boolean')
    }
    if (!uuid(id) || !validRoute(route) || !uuid(target?.mount) || !['source', 'slot', 'text'].includes(target.kind) ||
        !text(target.definition, 2048) || !text(target.field, 120) || !text(component?.name, 160) ||
        !/^[a-z][a-z0-9-]{0,60}$/.test(target.tag) || !state(beforeState) || !state(afterState)) {
      throw Error('Invalid component property edit')
    }
    const clean = value => target.kind === 'source' ? { value: value.value, overridden: value.overridden } :
      { value: value.value, visible: value.visible }
    const requested = String(afterState.value ?? 'None')
    return { id, route: journalRoute(route), property: target.kind === 'text' ? 'text' : 'component-' + target.field, before: String(beforeState.value ?? 'None'),
      requested, observed: requested, restore: 'session', intent: 'selected occurrence only',
      target: { kind: target.kind, mount: target.mount, definition: target.definition, field: target.field,
        tag: target.tag, slot: component.name, key: target.mount, id: null }, component: { name: component.name, prop: target.field },
      beforeState: clean(beforeState), afterState: clean(afterState) }
  }
  function buttonSizeEdit(record, registration) {
    if (!registration || !record || !/^[a-f0-9-]{36}$/.test(record.id) || !validRoute(record.route) ||
        record.target?.key !== registration.key || !buttonSizes.includes(record.before) ||
        !buttonSizes.includes(record.requested) || record.requested === record.before) {
      throw Error('Invalid Button Size edit')
    }
    return {
      id: record.id, route: journalRoute(record.route), property: 'button-size',
      target: { tag: 'button', id: null, slot: 'button', key: registration.key },
      before: record.before, requested: record.requested, observed: record.requested,
      restore: 'session', component: { name: 'Button', prop: 'size', source: registration.source },
      intent: 'selected occurrence only',
    }
  }

  return { editFrom, groupedPaddingEdits, validateTextStyleDefinition, textStyleEdits, componentPropertyEdit, buttonSizeEdit }
}
