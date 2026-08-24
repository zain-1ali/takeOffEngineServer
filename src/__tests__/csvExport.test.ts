import {
  buildTakeoffCsv,
  csvFilenameForProject,
  escapeCsvField,
} from '../utils/csvExport';

describe('takeoff CSV export', () => {
  it('quotes commas and quotes in fields', () => {
    expect(escapeCsvField('Living, dining')).toBe('"Living, dining"');
    expect(escapeCsvField('Say "hello"')).toBe('"Say ""hello"""');
  });

  it('builds the original Quantity Takeoff Table columns', () => {
    const csv = buildTakeoffCsv([
      {
        sheetName: 'Level 1',
        type: 'AREA',
        label: 'Bedroom 1',
        value: 12.5,
        unit: 'm²',
      },
    ]);
    expect(csv).toBe(
      'Sheet Name,Type,Label,Value,Unit\r\nLevel 1,AREA,Bedroom 1,12.5,m²\r\n',
    );
  });

  it('slugifies the download filename', () => {
    expect(csvFilenameForProject('North Wing / Rev A')).toBe(
      'North_Wing_Rev_A_export.csv',
    );
  });

  it('emits a header-only document when there are no measurements', () => {
    expect(buildTakeoffCsv([])).toBe('Sheet Name,Type,Label,Value,Unit\r\n');
  });
});
