/**
 * Minimal EDMX ($metadata) reader: entity sets and the properties / navigation properties of
 * their entity types. Enough to validate a configuration (entity set exists, mapped fields
 * exist) without an XML library. Works for OData V2 and V4 documents.
 */
export interface EntityTypeInfo {
  name: string;
  properties: Map<string, string>; // name -> Edm type
  navigation: Set<string>;
}

export interface ServiceMetadata {
  entitySets: Map<string, string>; // entity set -> entity type (unqualified)
  entityTypes: Map<string, EntityTypeInfo>;
}

const attributes = (tag: string) =>
  Object.fromEntries([...tag.matchAll(/([A-Za-z_][\w:.-]*)\s*=\s*"([^"]*)"/g)].map((m) => [m[1], m[2]]));

const unqualified = (name: string) => name.slice(name.lastIndexOf('.') + 1);

export const parseMetadata = (xml: string): ServiceMetadata => {
  const entityTypes = new Map<string, EntityTypeInfo>();
  for (const block of xml.matchAll(/<(?:\w+:)?EntityType\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?EntityType>/g)) {
    const name = attributes(block[1]).Name;
    if (!name) continue;
    const properties = new Map<string, string>();
    for (const p of block[2].matchAll(/<(?:\w+:)?Property\b([^>]*?)\/?>/g)) {
      const attrs = attributes(p[1]);
      if (attrs.Name) properties.set(attrs.Name, attrs.Type ?? '');
    }
    const navigation = new Set<string>();
    for (const n of block[2].matchAll(/<(?:\w+:)?NavigationProperty\b([^>]*?)\/?>/g)) {
      const attrs = attributes(n[1]);
      if (attrs.Name) navigation.add(attrs.Name);
    }
    entityTypes.set(name, { name, properties, navigation });
  }

  const entitySets = new Map<string, string>();
  for (const s of xml.matchAll(/<(?:\w+:)?EntitySet\b([^>]*?)\/?>/g)) {
    const attrs = attributes(s[1]);
    if (attrs.Name && attrs.EntityType) entitySets.set(attrs.Name, unqualified(attrs.EntityType));
  }
  return { entitySets, entityTypes };
};

/** Fields (first path segment) that are neither properties nor navigation properties of the set's type. */
export const missingFields = (metadata: ServiceMetadata, entitySet: string, fields: string[]): string[] | null => {
  const typeName = metadata.entitySets.get(entitySet);
  const type = typeName ? metadata.entityTypes.get(typeName) : undefined;
  if (!type) return null;
  const missing = new Set<string>();
  for (const field of fields) {
    const head = field.split(/[/.]/)[0];
    if (head && !type.properties.has(head) && !type.navigation.has(head)) missing.add(field);
  }
  return [...missing];
};
