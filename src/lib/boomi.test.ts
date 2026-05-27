import { describe, expect, it } from "vitest";
import { buildMapPreviewXml, createDraftFromTemplate, validateComponentXml } from "@/lib/boomi-sandbox";
import { sampleProject } from "@/lib/sample-data";
import { formatXmlForDisplay } from "@/lib/xml-utils";

const mappingSet = sampleProject.mappingSets[0];
const sourceProfile = sampleProject.profiles.find(
  (profile) => profile.id === mappingSet.sourceProfileId,
)!;
const destinationProfile = sampleProject.profiles.find(
  (profile) => profile.id === mappingSet.destinationProfileId,
)!;

describe("Boomi dry-run utilities", () => {
  it("builds a map component preview from project mappings", () => {
    const xml = buildMapPreviewXml(sampleProject, mappingSet, sourceProfile, destinationProfile);

    expect(xml).toContain('type="transform.map"');
    expect(xml).toContain("u_purchase_document_no");
    expect(validateComponentXml(xml).ok).toBe(true);
  });

  it("creates a dry-run draft diff from a template", () => {
    const proposedXml = buildMapPreviewXml(sampleProject, mappingSet, sourceProfile, destinationProfile);
    const draft = createDraftFromTemplate(
      sampleProject,
      mappingSet.name,
      "transform.map",
      sampleProject.boomiDrafts[0].templateXml,
      proposedXml,
    );

    expect(draft.validationStatus).toBe("Dry-run valid");
    expect(draft.diff).toContain("+");
  });

  it("blocks invalid component XML", () => {
    const result = validateComponentXml("<not-component />");

    expect(result.ok).toBe(false);
  });

  it("formats one-line component XML for display", () => {
    const xml = '<bns:Component type="transform.map" name="Imported"><bns:object><Map><field source="a" destination="b"/></Map></bns:object></bns:Component>';

    expect(formatXmlForDisplay(xml)).toBe(`<bns:Component type="transform.map" name="Imported">
  <bns:object>
    <Map>
      <field source="a" destination="b"/>
    </Map>
  </bns:object>
</bns:Component>`);
  });
});
