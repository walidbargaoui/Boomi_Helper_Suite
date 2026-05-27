import { describe, expect, it } from "vitest";
import {
  flattenJsonSample,
  importFields,
  parseDelimitedFields,
  parseXmlSample,
} from "@/lib/field-import";

describe("parseDelimitedFields (CSV/TSV)", () => {
  it("auto-detects comma delimiter with header row", () => {
    const text = "name,type,required\nu_company,String,true\nu_po_no,String,yes";
    const fields = parseDelimitedFields(text);
    expect(fields).toHaveLength(2);
    expect(fields[0]).toMatchObject({ name: "u_company", dataType: "String", required: true });
    expect(fields[1].required).toBe(true);
  });

  it("auto-detects tab delimiter and uses col1/col2 when no header is present", () => {
    const text = "po_no\tString\nqty\tInteger";
    const fields = parseDelimitedFields(text, { hasHeader: false });
    expect(fields).toHaveLength(2);
    expect(fields[0].name).toBe("po_no");
    expect(fields[1].name).toBe("qty");
  });

  it("respects quoted commas inside CSV cells", () => {
    const text = 'name,description\n"u_company","Company, primary"';
    const fields = parseDelimitedFields(text);
    expect(fields).toHaveLength(1);
    expect(fields[0].description).toBe("Company, primary");
  });

  it("captures required/key columns by header alias", () => {
    const text = "field,type,mandatory,key field\nid,String,yes,true\nname,String,no,false";
    const fields = parseDelimitedFields(text);
    expect(fields[0].required).toBe(true);
    expect(fields[0].keyField).toBe(true);
    expect(fields[1].required).toBe(false);
    expect(fields[1].keyField).toBe(false);
  });
});

describe("flattenJsonSample", () => {
  it("flattens nested objects and infers types", () => {
    const fields = flattenJsonSample({
      order: {
        id: "ABC-123",
        amount: 100.5,
        active: true,
        opened: "2026-05-01",
      },
    });
    const names = fields.map((field) => field.name);
    expect(names).toEqual(expect.arrayContaining(["id", "amount", "active", "opened"]));
    const opened = fields.find((field) => field.name === "opened");
    expect(opened?.dataType).toBe("Date");
    const amount = fields.find((field) => field.name === "amount");
    expect(amount?.dataType).toBe("Decimal");
  });

  it("uses first array element to infer fields", () => {
    const fields = flattenJsonSample({ items: [{ sku: "A", qty: 1 }] });
    expect(fields.map((field) => field.name).sort()).toEqual(["qty", "sku"]);
  });
});

describe("parseXmlSample", () => {
  it("extracts leaf paths from a simple XML sample", () => {
    const xml = "<order><id>123</id><line><sku>A</sku><qty>2</qty></line></order>";
    const fields = parseXmlSample(xml);
    const names = fields.map((field) => field.name);
    expect(names).toEqual(expect.arrayContaining(["id", "sku", "qty"]));
  });
});

describe("importFields dispatcher", () => {
  it("dispatches to csv branch and produces parsed fields", () => {
    const fields = importFields({ kind: "csv", payload: "name,type\nfoo,String" });
    expect(fields[0].name).toBe("foo");
  });

  it("dispatches to json branch", () => {
    const fields = importFields({ kind: "json", payload: '{"a": 1, "b": "x"}' });
    expect(fields.map((field) => field.name).sort()).toEqual(["a", "b"]);
  });

  it("dispatches to xml branch", () => {
    const fields = importFields({ kind: "xml", payload: "<root><x>1</x></root>" });
    expect(fields[0].name).toBe("x");
  });
});
