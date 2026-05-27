# Boomi Component XML — Schema Learnings

Written after studying **864 real components** across two Boomi sandboxes:
- `avaxia-9FCJIF` — 60 samples (15 each of `transform.map`, `profile.flatfile`, `profile.json`, `profile.xml`)
- `jeracoinc-POEAF2` — 804 samples (99 maps, 149 flatfile, 220 json, 232 xml, 104 db). This one is much richer — it contains function chains, profile.db (a type the first sandbox didn't have), and a wider variety of JSON/datetime/array patterns.

Source of truth for the generators in `src/lib/boomi-xml.ts`. The current V1 covers the core shapes; this doc captures what V1 misses and what M6 needs to add.

---

## 1. Envelope (every component)

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<bns:Component
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xmlns:bns="http://api.platform.boomi.com/"
    folderFullPath="Avaxia/.../Folder"
    componentId="UUID"
    version="1"
    name="..."
    type="profile.flatfile | profile.json | profile.xml | transform.map"
    createdDate="ISO" createdBy="email"
    modifiedDate="ISO" modifiedBy="email"
    deleted="false" currentVersion="true"
    folderName="..." folderId="Rjo..."
    branchName="main" branchId="QjozMTMzMzk"
    copiedFromComponentId="UUID" copiedFromComponentVersion="N">
  <bns:encryptedValues/>
  <bns:description></bns:description>
  <bns:object>
    <!-- type-specific inner element, declares xmlns="" -->
  </bns:object>
</bns:Component>
```

Notes:
- Inner element ALWAYS declares `xmlns=""` to reset the default namespace.
- `bns:description` is present even when empty — never self-closed.
- `bns:encryptedValues` is always self-closed.
- `copiedFrom*` only appears when the component was duplicated.
- Boomi assigns `folderId`/`branchId`/`componentId` server-side; client doesn't need to provide them on create.

---

## 2. `transform.map`

### Shape

```xml
<Map xmlns="" fromProfile="UUID" toProfile="UUID">
  <Mappings>
    <!-- direct field-to-field -->
    <Mapping fromKey="N" fromKeyPath="..." fromNamePath="..." fromType="profile"
             toKey="N" toKeyPath="..." toNamePath="..." toType="profile"/>
    <!-- field → function input -->
    <Mapping fromKey="N" fromKeyPath="..." fromNamePath="..." fromType="profile"
             toFunction="<step-key>" toKey="<input-index>" toType="function"/>
    <!-- function output → field -->
    <Mapping fromFunction="<step-key>" fromKey="<output-index>" fromType="function"
             toKey="N" toKeyPath="..." toNamePath="..." toType="profile"/>
    <!-- with cache join (rarely seen but legal) -->
    <Mapping fromCacheJoinKey="0" fromKey="N" ... />
  </Mappings>
  <Functions optimizeExecutionOrder="true">
    <FunctionStep cacheEnabled="true" cacheOption="none" category="String"
                  key="<step-key>" name="..." position="N" sumEnabled="false"
                  type="<FunctionType>" x="10.0" y="10.0">
      <Inputs>
        <Input key="1" name="Original String"/>
        <Input default="<constant>" key="2" name="String to Remove"/>
      </Inputs>
      <Outputs>
        <Output key="2" name="Result"/>
      </Outputs>
      <Configuration>
        <!-- type-specific config (see below). Often empty. -->
      </Configuration>
    </FunctionStep>
  </Functions>
  <Defaults>
    <Default toKey="N" value="..."/>
  </Defaults>
  <DocumentCacheJoins/>
</Map>
```

### Function chain catalogue (from the jeracoinc sandbox)

The avaxia sandbox had zero functions across 30 maps; jeracoinc has plenty. Observed function types (with counts across ~99 maps):

| Type | Count | Category | Purpose |
| --- | ---: | --- | --- |
| `Scripting` | 58 | `Scripting` | Embedded JavaScript/Groovy via `<ScriptToExecute>` |
| `MathMultiply` | 45 | `Numeric` | Multiply two numeric inputs |
| `userdefined` | 27 | `userdefined` | Reference a Map Function component by UUID (`id="UUID"`) |
| `SqlLookup` | 14 | `Lookup` | Run a SQL query against a Database connection |
| `StringConcat` | 6 | `String` | Concatenate strings |
| `DateFormat` | 5 | `Date` | Format a date with a SimpleDateFormat pattern |
| `StringPrepend` | 4 | `String` | Prepend a constant to a string |
| `CurrentDate` | 4 | `Date` | Emit `now()` as a formatted string |
| `RightTrim`, `LeftTrim`, `WhitespaceTrim` | 5 | `String` | Trim helpers |
| `PropertyGet`, `DocumentPropertyGet`, `DocumentPropertySet` | 5 | `ProcessProperty` | Read/write Boomi process or document properties |
| `LineItemIncrement` | 1 | `Numeric` | Auto-increment counter per output line |
| `MathPrecision` | 1 | `Numeric` | Set decimal precision |

### Function Configuration variants

**`Scripting`**:
```xml
<Configuration>
  <Scripting language="javascript" useComponent="false">
    <ScriptToExecute>function find(list, f){ ... }</ScriptToExecute>
  </Scripting>
</Configuration>
```
JavaScript code is inline. `useComponent="true"` would reference an external Script component instead.

**`SqlLookup`**:
```xml
<Configuration>
  <SqlLookup connection="<UUID>" executionType="sql" spResultOption="resultset"
             storedProcedureName="">
    <SqlToExecute>SELECT col FROM t WHERE id = ?</SqlToExecute>
    <Input dataType="character" index="1" name="input"/>
    <Output dataType="character" index="2" name="output"/>
  </SqlLookup>
</Configuration>
```
`connection` is a Database connection component UUID. Inputs/Outputs here are duplicated with the FunctionStep's outer Inputs/Outputs.

**`userdefined`** (Map Function component reference):
```xml
<FunctionStep category="userdefined" id="<MapFunctionUUID>" key="1" name="my_lookup"
              position="1" type="userdefined" x="10.0" y="10.0">
  <Inputs>
    <Input key="1" name="mail"/>
  </Inputs>
  <Outputs/>           <!-- can be empty -->
  <Configuration/>     <!-- empty for userdefined -->
</FunctionStep>
```
The `id` attribute points to a separate Boomi Map Function component. Configuration is empty.

**Simple library functions** (`StringRemove`, `MathMultiply`, `CurrentDate`, etc.) have an empty `<Configuration/>` — all config lives in their `Input`s (some with `default="..."` for constant values).

### What I learned (updated)

- **Four siblings in fixed order**: `Mappings`, `Functions`, `Defaults`, `DocumentCacheJoins`. All four are always present, even when empty (`<Defaults/>`, `<DocumentCacheJoins/>`, `<Functions optimizeExecutionOrder="true"/>`).
- **Mapping element is leaf** — never has children. All info is in attributes.
- **fromKeyPath/toKeyPath syntax**: nested XPath with `*[@key='N']` segments. Depth matches the profile's element nesting.
- **fromNamePath/toNamePath** mirror the key path but use human-readable names.
- **fromType / toType** values: `profile`, `function`. Routing through a function step uses TWO Mappings: one with `toType="function"` and one with `fromType="function"`.
- **`fromFunction` / `toFunction`** attributes carry the FunctionStep's `key`. The `fromKey`/`toKey` in those mappings carries the function's Input or Output `key`, NOT a profile element key.
- **`fromCacheJoinKey="0"`** appears on Mapping when the source is a cache-join document. Tied to `<DocumentCacheJoins>`.
- **FunctionStep `key`** numbering is per-map (1, 2, 3...). `position` controls execution order (matches `optimizeExecutionOrder` semantics).
- **FunctionStep `x` / `y`** are UI canvas coordinates (decimal strings like `"10.0"`). Boomi tolerates `"0.0"` defaults.
- **Defaults override or supplement** mappings. `<Default toKey="N" value="..."/>` — values are raw text.
- **fromProfile / toProfile** are Boomi profile component UUIDs.
- **Keys are global within profiles, not maps**. A map's `fromKey="1894"` must match a real key in the source profile component.

### Gaps vs V1

| Gap | V1 today | What M6 needs |
| --- | --- | --- |
| Profile UUIDs | Uses local Helper Suite IDs | Read `componentId` from imported profile template |
| Element keys | Sequential per-map | Pull keys from imported profile template's data elements |
| Function chains | Generic stub | 11 function types observed — implement at least Scripting / MathMultiply / StringConcat / DateFormat / CurrentDate / SqlLookup / userdefined |
| Function-routed mappings | Treats all as direct | Emit dual Mapping (field→function + function→field) when rule has `expression` or `mappingType: "function"` |
| Mapping ordering | Source order | OK |

---

## 3. `profile.flatfile`

### Two flavors based on `fileType`

**Delimited (`fileType="delimited"`)**: comma/tab/star/pipe-separated. Each `FlatFileElement` uses `maxLength="N"` (no `length`).

```xml
<FlatFileProfile xmlns="" modelVersion="2" strict="true">
  <ProfileProperties>
    <GeneralInfo fileType="delimited" useColumnHeaders="true"/>
    <Options>
      <DataOptions/>
      <DelimitedOptions fileDelimiter="commadelimited" removeEscape="false" textQualifier="na"/>
    </Options>
  </ProfileProperties>
  <DataElements>
    <FlatFileRecord detectFormat="numberofcolumns" isNode="true" key="1" name="Record">
      <FlatFileElements isNode="true" key="2" name="Elements">
        <FlatFileElement dataType="character" enforceUnique="false" identityValue=""
                         isMappable="true" isNode="true" justification="left" key="3"
                         mandatory="true" maxLength="9" minLength="0" name="..."
                         useToIdentifyFormat="false" validateData="true">
          <DataFormat><ProfileCharacterFormat/></DataFormat>
        </FlatFileElement>
        <!-- ... more elements ... -->
      </FlatFileElements>
    </FlatFileRecord>
  </DataElements>
</FlatFileProfile>
```

**Fixed-width (`fileType="datapositioned"`)**: uses `length="N"` per element. `<DelimitedOptions>` is STILL emitted (with a placeholder delimiter) even though it's unused. `useColumnHeaders` is omitted.

```xml
<GeneralInfo fileType="datapositioned" useColumnHeaders="false"/>
<DelimitedOptions fileDelimiter="stardelimited" removeEscape="false" textQualifier="na"/>
<!-- ... -->
<FlatFileElement length="10" maxLength="0" .../>
```

### What I learned

- `fileDelimiter` enum seen in samples: **`commadelimited`** (14/15), `stardelimited` (1/15). Other valid values per Boomi docs include `tabdelimited`, `pipedelimited`, `semicolondelimited`.
- **DelimitedOptions is always emitted**, even for `datapositioned` files. Don't conditionally omit it.
- **Single FlatFileRecord per profile** in 15/15 sampled files. Multi-record profiles (for EDI-style mixed records) exist in Boomi but are absent from this sandbox.
- **Element keys are sparse** — `FlatFileRecord` key=1, `FlatFileElements` key=2, then `FlatFileElement` keys jump to 3, 5, 7, 9 etc. (odd-numbered, gaps of 2 — possibly because Boomi reserves intermediate keys for `<DataFormat>` children).
- **Data type binary**: only `character` and `number` observed on FlatFileElement. No `boolean`/`datetime`. Numbers use `<DataFormat><ProfileNumberFormat/></DataFormat>`, everything else `<ProfileCharacterFormat/>`.
- **`mandatory`** maps to local `required`. **`maxLength`** maps to local `length` for delimited, ignore for datapositioned. **`length`** is the fixed-width column width.
- **`identityValue=""`** is always empty in samples. Used for record-type discrimination in multi-record profiles.
- `useToIdentifyFormat="false"` and `validateData="true"` are the defaults observed.

### Gaps vs V1

| Gap | V1 today | What M6 needs |
| --- | --- | --- |
| Element keys | Sequential 3, 4, 5... | Should be odd numbers 3, 5, 7... to match Boomi's pattern (cosmetic — Boomi may accept either) |
| Multi-record | Not supported | Probably out of scope for V1 — none in this sandbox |
| `length` vs `maxLength` | Treats them the same | Use `length` for datapositioned, `maxLength` for delimited (V1 may already be close — verify) |

---

## 4. `profile.json`

### Three nesting patterns

**(a) Root object** — simplest:

```xml
<JSONProfile xmlns="" strict="false">
  <DataElements>
    <JSONRootValue dataType="character" isMappable="true" isNode="true" key="1" name="Root">
      <DataFormat><ProfileCharacterFormat/></DataFormat>
      <JSONObject isMappable="false" isNode="true" key="2" name="Object">
        <JSONObjectEntry dataType="character" isMappable="true" isNode="true" key="3" name="field1">
          <DataFormat><ProfileCharacterFormat/></DataFormat>
        </JSONObjectEntry>
        <!-- more entries -->
      </JSONObject>
      <Qualifiers><QualifierList/></Qualifiers>
    </JSONRootValue>
  </DataElements>
  <tagLists/>
</JSONProfile>
```

**(b) Root array** — when the top-level JSON is `[...]`:

```xml
<JSONRootValue dataType="character" isMappable="true" isNode="true" key="1" name="schema">
  <DataFormat><ProfileCharacterFormat/></DataFormat>
  <JSONArray elementType="repeating" isMappable="false" isNode="true" key="2" name="Array">
    <JSONArrayElement dataType="character" isMappable="true" isNode="true" key="3"
                      maxOccurs="-1" minOccurs="0" name="items1">
      <DataFormat><ProfileCharacterFormat/></DataFormat>
      <JSONObject isMappable="false" isNode="true" key="4" name="Object">
        <JSONObjectEntry .../>
      </JSONObject>
    </JSONArrayElement>
  </JSONArray>
</JSONRootValue>
```

**(c) Nested arrays under an entry** — array as a property:

```xml
<JSONObjectEntry dataType="character" key="43" name="items">
  <DataFormat><ProfileCharacterFormat/></DataFormat>
  <JSONArray elementType="repeating" isMappable="false" isNode="true" key="44" name="Array">
    <JSONArrayElement dataType="character" key="45" maxOccurs="-1" minOccurs="0" name="ArrayElement1">
      <DataFormat><ProfileCharacterFormat/></DataFormat>
      <JSONObject isMappable="false" isNode="true" key="46" name="Object">
        <JSONObjectEntry .../>
      </JSONObject>
    </JSONArrayElement>
  </JSONArray>
</JSONObjectEntry>
```

### Element family

| Element | Role | Children |
| --- | --- | --- |
| `JSONRootValue` | Root wrapper, always key=1, always present | `DataFormat`, then `JSONObject` OR `JSONArray`, then `Qualifiers` |
| `JSONObject` | Maps a JSON object | `JSONObjectEntry*` |
| `JSONObjectEntry` | One key in an object | `DataFormat`, optional `JSONObject`/`JSONArray`, optional `Qualifiers` |
| `JSONArray` | Maps a JSON array | One `JSONArrayElement` describing each element |
| `JSONArrayElement` | Describes the array's element shape | `DataFormat`, optional `JSONObject` or further `JSONArray` |
| `Qualifiers` / `QualifierList` | Validation / enum metadata (always empty in samples) | usually `<QualifierList/>` |
| `tagLists` | XML profile cross-ref (always `<tagLists/>`) | empty |

### Optional bits

- `<GeneratorConfig enableFieldLengthValidation="true" enableParseDateTime="true"/>` — added by newer Boomi versions, sits between `<JSONProfile>` and `<DataElements>`. Optional.
- `description="..."` on `JSONObjectEntry` — Japanese descriptions from SAP fields.
- `maxLength="N"` and `validateData="true"` on entries for typed numeric/character fields.
- `allowEmpty="false"` — some entries.

### dataType values

- `character` (most common)
- `number` — uses `<DataFormat><ProfileNumberFormat/></DataFormat>`
- `boolean` — uses `<DataFormat><ProfileCharacterFormat/></DataFormat>` (yes, character format)
- `datetime` — uses `<DataFormat><ProfileDateFormat dateFormat="yyyy-MM-dd"/></DataFormat>` (with a date pattern)

### Gaps vs V1

| Gap | V1 today | What M6 needs |
| --- | --- | --- |
| Root arrays | Always emits a root `<JSONObject>` | If profile data suggests array root, emit `<JSONArray><JSONArrayElement><JSONObject>...` |
| Nested arrays | Treats array-of-X same as object-of-X | Detect array structure from local fields (e.g., `items` parent with multiple children = array) |
| `datetime` dataType | Mapped to `character` | Emit `<ProfileDateFormat dateFormat="yyyy-MM-dd"/>` |
| `boolean` dataType | Mapped to `character` | Emit as `dataType="boolean"` with `<ProfileCharacterFormat/>` |
| `description` attr | Not emitted | Copy from local field `description` |
| `Qualifiers` placement | V1 emits on JSONRootValue (correct), unclear on entries | Boomi tolerates both; safer to omit on entries |
| `GeneratorConfig` | Not emitted | Optional — can stay omitted, Boomi tolerates absence |
| Field names with dots / `@EXTERNAL` | Treated as nested paths | They're literal names; don't split |

---

## 5. `profile.xml`

This is the most complex of the four — by an order of magnitude. Samples ranged 2 KB to 1 MB. Skipping deep coverage because V1 deliberately punts to template-passthrough, but I want to capture the key shapes for M6.

### Outer structure

```xml
<XMLProfile xmlns="" modelVersion="2" strict="true">
  <ProfileProperties>
    <XMLGeneralInfo/>
    <XMLOptions encoding="utf8" implicitElementOrdering="true" parseRespectMaxOccurs="true"/>
  </ProfileProperties>
  <DataElements>
    <XMLElement ...>     <!-- recursive tree of XMLElement -->
      <DataFormat><ProfileCharacterFormat/></DataFormat>
      <XMLElement .../>
      ...
    </XMLElement>
  </DataElements>
  <Namespaces>
    <XMLNamespace key="-1" name="Empty Namespace" prefix="ns1">
      <Types>
        <Type anonymous="true|false" declarationClass="cType" typeKey="N">
          <XMLElement ...>
            <!-- type-shape definition, mirrors DataElements shape -->
          </XMLElement>
        </Type>
        <!-- ... more Types ... -->
      </Types>
    </XMLNamespace>
  </Namespaces>
</XMLProfile>
```

### Two parallel sections

- **`<DataElements>`** — the instance hierarchy. What the actual document looks like.
- **`<Namespaces>/<Types>`** — type definitions. Reused by typeKey references.

Each `<XMLElement>` in DataElements carries:
- `typeKey="N"` — reference into Types table (`-1` = anonymous inline)
- `typeExpanded="true|false"` — whether the type is expanded inline in DataElements or only referenced
- `typeName="..."` — name of the type when it's a named complex type

If `typeExpanded="false"`, the actual structure lives in the Types table. The DataElements entry just declares "this element is of type X".

### Other XMLElement attrs

- `dataType="character"` or `dataType="number"` (and possibly more)
- `maxOccurs="-1"` (unbounded), `maxOccurs="1"`
- `minOccurs="0"` or `"1"`
- `maxLength` / `minLength`
- `loopingOption="unique"`
- `useNamespace="-1"` (or namespace key for namespaced elements)
- `validateData="true"` / `"false"`
- `comments="..."` — SAP field descriptions

### Why V1 punts on patching

Patching XML profiles correctly requires:
1. Understanding that `<DataElements>` and `<Types>` are coupled — a change to a complex type's structure may require updating both.
2. Sequential typeKeys that thread the two sections together. Adding a new element means assigning fresh keys without breaking existing references.
3. Round-tripping through XSD inference if we want to support importing JSON Schema / XSD → XML profile.

For V1, template-passthrough is correct. M6 should either:
- Support **name-only edits** within the existing template (rename elements, change `comments`, toggle `validateData`), no structural changes; **or**
- Mark XML profiles as "manual edit in Boomi UI" and exclude from publish.

### Gaps vs V1

| Gap | V1 today | What M6 needs |
| --- | --- | --- |
| DataElements + Types coupling | Not handled | Either name-only edits OR mark out-of-scope |
| Namespaces | Empty stub | Preserve template's Namespaces verbatim |
| typeKey/typeExpanded | Generated with -1/true | Use template's existing keys when patching |

---

## 5b. `profile.db` (NEW — not in the first sandbox)

A profile.db describes a single database operation: a `SELECT`, an `INSERT`, an
`UPDATE`, a `DELETE`, an UPSERT, or a stored procedure call. The profile's
fields are the columns Boomi maps to / from when the operation runs.

### Shape

```xml
<DatabaseProfile xmlns="" strict="true" version="2">
  <ProfileProperties>
    <DatabaseGeneralInfo executionType="dbread | dbwrite"/>
  </ProfileProperties>
  <DataElements>
    <DBStatement isNode="true" key="N" name="Statement"
                 statementType="select | dynamicinsert | dynamicupdate | standardinsertupdatedelete | storedprocedure"
                 storedProcedure="" tableName="<schema.table or empty>">
      <DBFields isNode="true" key="N" name="Fields" type="result_set">
        <DatabaseElement dataType="character | number | datetime"
                         enforceUnique="false" isMappable="true" isNode="true"
                         key="N" mandatory="false" name="COLUMN_NAME">
          <DataFormat><ProfileCharacterFormat/></DataFormat>
        </DatabaseElement>
      </DBFields>
      <DBParameters isNode="true" key="N" name="Parameters">
        <DBParameter isMappable="false" isNode="true" key="N" name="bind_var_name">
          <DataFormat><ProfileCharacterFormat/></DataFormat>
        </DBParameter>
      </DBParameters>
      <DBConditions isNode="true" key="N" name="Conditions">
        <DBCondition conditionOperator="equal | notequal | greater | less | like | ..."
                     isMappable="true" isNode="true" key="N" name="ID">
          <DataFormat><ProfileCharacterFormat/></DataFormat>
        </DBCondition>
      </DBConditions>
      <sql>SELECT col1, col2 FROM tbl WHERE id = ?</sql>
    </DBStatement>
    <!-- A profile.db can have multiple DBStatement siblings (e.g. UPSERT) -->
  </DataElements>
</DatabaseProfile>
```

### What I learned

- **`executionType`**: `dbread` (SELECT, stored procedure with result set) or `dbwrite` (INSERT/UPDATE/DELETE/UPSERT).
- **`statementType`** observed values:
  - `select` — `<DBFields type="result_set">` + `<DBParameters>` (bind variables) + `<sql>`
  - `dynamicinsert` — `<DBFields>` (the columns to insert) + empty `<sql>` (Boomi generates `INSERT INTO {tableName} ...`)
  - `dynamicupdate` — `<DBFields>` + `<DBConditions>` (the WHERE clause) + empty `<sql>`
  - `standardinsertupdatedelete` — raw SQL in `<sql>` plus `<DBFields>` and `<DBParameters>`
  - `storedprocedure` — uses `storedProcedure="<name>"` attribute, `<DBParameters>` for IN/OUT params
- **A single profile.db can have multiple `<DBStatement>` siblings** under `<DataElements>` (sample: `SEND_tffm05_ODS_1_8_3` has both a `dynamicupdate` and a `dynamicinsert` — that's how Boomi models upsert).
- **`tableName`** is fully-qualified: `TR3AOWN.tffm05` (schema.table). Can be empty for `select` (the table comes from the SQL).
- **`DBFields type="result_set"`** appears on read statements. Write statements typically omit the `type` attribute on `<DBFields>`.
- **`DatabaseElement`** shape mirrors `FlatFileElement` / `JSONObjectEntry`: `dataType`, `name`, `key`, `mandatory`, `<DataFormat>` child. dataTypes observed: `character`, `number`, `datetime` (with `<ProfileDateFormat/>` — no format string).
- **`DBParameter`** is the parameter container shape — same attributes as DatabaseElement, just a different tag.
- **`DBCondition`** is for `dynamicupdate` WHERE clauses. Carries `conditionOperator="equal"` etc.
- **Empty profile** (just created in UI): everything is present but `<DBFields/>`, `<DBParameters/>`, `<sql/>` are empty stubs. Smallest seen: 1082 bytes.
- **No `description` attribute** observed on database elements (unlike JSON, where SAP profiles carry Japanese descriptions).

### Gaps vs V1

V1 doesn't generate `profile.db` at all. It's not in the local `Profile["type"]` enum (which has `Flat File | JSON | XML | Database | API`). Today `Database` is routed to `profile.flatfile` via `profileComponentType()` — which produces wrong-shape XML.

| Gap | V1 today | What M6 needs |
| --- | --- | --- |
| `Database` profile.type → componentType | Maps to `profile.flatfile` | Add `profile.db` as a real componentType, route `Database` to it |
| Statement type | N/A | Derive from local model: read vs write, simple vs upsert |
| tableName / storedProcedure | N/A | Need a new local field on `Profile` (e.g., `tableName`) |
| SQL or generated | N/A | If local has explicit SQL, use it; otherwise emit empty `<sql/>` and set `dynamicinsert`/`dynamicupdate` |
| DBConditions | N/A | New local field on `MappingRule` or new entity for WHERE-clause keys |
| DBParameters | N/A | New local concept for stored proc / SELECT params |

This is the **biggest gap** — a whole component type. M6 must add `profile.db` support both in the local data model (new `Profile["type"]` variant and supporting fields) and the generator.

---

## 6. Cross-cutting observations

- **Quotes**: Boomi always uses double-quotes for attributes. The few apostrophes in field names (e.g., `&apos;`) are XML-escaped.
- **Self-closing vs paired**: `<bns:description></bns:description>` is paired (likely because it can hold text); `<bns:encryptedValues/>` and `<DocumentCacheJoins/>` are self-closed. fast-xml-parser's serializer flips these — Boomi tolerates both.
- **Attribute ordering**: Boomi emits attributes in a fixed alphabetical-ish order on each element. fast-xml-parser preserves the order it sees. For round-trip patching, order is preserved if we don't touch the attributes object.
- **Whitespace**: Boomi outputs **zero whitespace between tags** (single-line XML). Pretty-printing is for humans only — when comparing/patching, normalize whitespace first.
- **Date formats** appear in JSON and profile.db (datetime fields). Patterns are Java SimpleDateFormat strings: `yyyy-MM-dd`, `yyyy-MM-dd HH:mm:ss`, `yyyy-MM-dd'T'HH:mm:ss.SSSZZ` (ISO with timezone), `yyyy-MM-dd'T'HH:mm:ss.SSS'Z'`, `yyyy/MM/dd`. profile.db uses `<ProfileDateFormat/>` (no format string — Boomi infers from the column). Flat-file profiles never use a date format in this sandbox.
- **fileDelimiter enum**: `commadelimited`, `tabdelimited`, `stardelimited`, `bardelimited` (pipe), `semicolondelimited` per Boomi docs. Most common: `commadelimited`.
- **Keys are not portable**: profile element keys are global within the Boomi account/profile. A transform.map publishes successfully only if `fromKey`/`toKey` match keys in the profiles referenced by `fromProfile`/`toProfile`. Without those imported, the published map will fail Boomi-side validation.

---

## 7. M6 priority list (refined after 864 samples)

1. **Key + UUID reconciliation** (highest) — read element keys and `componentId` from imported source/destination profile templates, substitute into generated `transform.map`. Without this, nothing publishes correctly.
2. **Add `profile.db` as a first-class component type** — biggest new finding. Local `Profile["type"]` needs a real DB variant with `tableName`, `statementType`, optional explicit SQL, and condition/parameter columns. Generator emits `<DatabaseProfile>` not `<FlatFileProfile>`.
3. **`transform.map` function chains** — 11 function types observed. Implement at least the common ones (Scripting, MathMultiply, StringConcat, DateFormat, CurrentDate, SqlLookup, userdefined). Emit dual Mapping (field → function → field) when a rule has function metadata.
4. **JSON arrays + datetime + boolean** — emit `<JSONArray><JSONArrayElement><JSONObject>` for arrays, `<ProfileDateFormat dateFormat="..."/>` for datetime, `dataType="boolean"` for boolean.
5. **JSON root detection** — when local model represents a root array, emit `<JSONArray>` under `JSONRootValue` instead of `<JSONObject>`.
6. **Flat-file fixed-width** — emit `length=` and `<GeneralInfo fileType="datapositioned" ...>` correctly. Add `bardelimited` to the delimiter enum alongside comma/tab/star/pipe.
7. **`profile.xml`** — keep template-passthrough only. Full DataElements + Types coupling is out of scope for V1.

---

## 8. Confidence summary

| Component | Scaffold V1 | Template-patch V1 | Confidence after 864 samples |
| --- | --- | --- | --- |
| `profile.flatfile` | ✅ shape-correct | ✅ DataElements swap works | High |
| `profile.json` (object root, flat) | ✅ | ✅ | High |
| `profile.json` (arrays, nested, datetime, boolean) | ❌ array shape wrong | ❌ same | Medium — clear what to fix |
| `profile.xml` (passthrough) | ✅ pass through template | ✅ | High for passthrough; structural patching out of V1 |
| `profile.db` | ❌ doesn't exist | ❌ doesn't exist | High that I now know the shape; needs local-model work too |
| `transform.map` (direct + defaults) | ✅ shape-correct | ✅ Mappings swap works | High |
| `transform.map` (function chains) | ❌ stub `<Function>` is wrong tag (real is `<FunctionStep>`) | ❌ same | Medium — 11 function types catalogued, can implement incrementally |
| Key + UUID reconciliation | ❌ placeholders | ❌ same | High — known dependency on imported templates |

**The single biggest blocker for publish-correctness** is reading keys + componentIds from imported profile templates. Everything else is incremental.

**The biggest brand-new finding from the jeracoinc sandbox** is `profile.db` — it requires new local schema work (a new `Profile["type"]` variant and supporting fields) before the generator can do anything meaningful with it.
