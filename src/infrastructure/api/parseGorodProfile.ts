import type { BuildingProfile } from '../../domain/BuildingProfile';

const text = (element: Element | null) => element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
function number(value: string): number | null {
  if (!/^\d+(?:[.,]\d+)?$/.test(value.replace(/\s/g, ''))) return null;
  const n = Number(value.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
const rows = (root: ParentNode) => Array.from(root.querySelectorAll('tr')).map((row) => Array.from(row.querySelectorAll('td')).map(text)).filter((row) => row.length > 0);

export function parseGorodProfile(html: string, address: string, sourceUrl: string): BuildingProfile {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (!doc.querySelector('.facility-tep')) return parseUnpublishedPassport(doc, address, sourceUrl);
  const allRows = rows(doc.querySelector('.sidebar-page__content') ?? doc);
  const value = (label: string) => number(allRows.find((r) => r[0] === label)?.at(-1) ?? '');
  const apartments = (pattern: RegExp) => {
    const section = Array.from(doc.querySelectorAll('.facility-tep-section__subsection'))
      .find((s) => pattern.test(text(s.querySelector('.facility-tep-section__subtitle'))));
    return section ? number(rows(section).find((r) => r[0] === 'Количество квартир')?.at(-1) ?? '') : null;
  };
  const ageSection = Array.from(doc.querySelectorAll('.accordion')).find((s) => /Половозрастные/i.test(text(s.querySelector('.accordion__name'))));
  const ageRows = ageSection ? rows(ageSection) : [];
  const ageCount = (pattern: RegExp) => {
    const values = ageRows.filter((r) => pattern.test(r[0])).map((r) => number(r[1] ?? ''));
    return values.length === 2 && values.every((n) => n !== null) ? values.reduce<number>((sum, n) => sum + n!, 0) : null;
  };
  const repairSection = doc.querySelector('#tab1_section2')?.closest('.facility-tep-section');
  const repairs = (repairSection ? rows(repairSection) : []).flatMap((r) => {
    const year = number(r[0]);
    return year && year >= 1800 && r[1] && r[1] !== '-' ? [{ year, work: r[1] }] : [];
  });
  const wear: Record<string, number> = {};
  const features: BuildingProfile['features'] = [];
  for (const table of Array.from(doc.querySelectorAll('table'))) {
    const headers = Array.from(table.querySelectorAll('thead th')).map(text);
    const index = headers.findIndex((h) => h === 'Износ элемента');
    if (index < 0) continue;
    for (const row of rows(table)) {
      const n = number(row[index] ?? '');
      if (n !== null && n <= 100) wear[row[0]] = n;
      const description = row[headers.findIndex((h) => h === 'Описание конструктивного элемента')];
      if (/^(Стены|Лестницы|Перекрытия|Полы|Крыша)$/.test(row[0]) && description && !/^[-—\s]+$/.test(description) && number(description) !== 0) {
        features.push({ label: row[0], value: description });
      }
    }
  }
  for (const row of allRows) {
    const label = row[0];
    const value = row.at(-1) ?? '';
    if (/^Материал (?:стен|лестниц|перекрытий)/i.test(label) && value && !/^[-—\s\d.,]+$/.test(value)) features.push({ label, value });
    const n = number(value);
    if (n === null || n <= 0) continue;
    if (/^Площадь дощатых полов на лестничных клетках$/i.test(label)) features.push({ label: 'Дерево в интерьере', value: 'Есть дощатые полы на лестничных клетках', detail: 'Дощатый пол не подтверждает деревянную конструкцию лестницы.' });
    if (/^Площадь полов из керамической плитки$/i.test(label)) features.push({ label: 'Плитка', value: 'Есть керамическая плитка', detail: 'Возраст, рисунок и сохранность плитки в паспорте не указаны.' });
    if (/^Площадь паркетных полов$/i.test(label)) features.push({ label: 'Паркет', value: 'Есть паркетные полы', detail: 'Возраст паркета не указан.' });
    if (/^(?:Количество|Число) каминов$/i.test(label)) features.push({ label: 'Камины', value: 'Указаны в паспорте дома' });
  }
  const heating = Array.from(doc.querySelectorAll('.facility-tep-section__subsection')).find((s) => text(s.querySelector('.facility-tep-section__subtitle')) === 'Отопление');
  if (heating && rows(heating).some((r) => r[0] === 'Печное' && r[1] === 'Есть')) {
    features.push({ label: 'Печи', value: 'В паспорте указано печное отопление', detail: 'Наличие каминов и сохранность печей отдельно не подтверждены.' });
  }
  return { address, sourceUrl, fetchedAt: new Date().toISOString(), yearBuilt: value('Год постройки'), floors: value('Число этажей'), residents: value('Количество проживающих'),
    communalFlats: apartments(/^Коммунальные|^Коммунальное/i), separateFlats: apartments(/^Отдельные квартиры/i),
    ages: { children: ageCount(/^Дети и подростки/i), working: ageCount(/^Трудоспособный возраст/i), older: ageCount(/^Лица старше труд/i) }, repairs, wear, features, plans: [], plansAvailable: false };
}

/** A valid building page without a published passport is a source state, not a transport or parser failure. */
function parseUnpublishedPassport(doc: Document, address: string, sourceUrl: string): BuildingProfile {
  const notice = doc.querySelector('.facility-no-tep');
  const title = text(doc.querySelector('.facility-header__name'));
  if (!notice || !title) throw new Error('Gorod building passport unavailable');
  const headers = new Map(Array.from(doc.querySelectorAll('.facility-header__info-block')).map(block => [
    text(block.querySelector('.facility-header__info-label')), text(block.querySelector('.facility-header__info-value')),
  ]));
  const kind = headers.get('Тип');
  const features = kind && !/^(?:0|[-—\s]+)$/.test(kind) ? [{ label: 'Назначение', value: kind === 'Нежилое' ? 'Нежилое здание' : kind }] : [];
  return { address: title || address, sourceUrl, fetchedAt: new Date().toISOString(),
    passportStatus: /актуализац/i.test(text(notice)) ? 'updating' : 'not-published',
    yearBuilt: number(headers.get('Год постройки') ?? ''), floors: number(headers.get('Этажей') ?? ''),
    residents: null, communalFlats: null, separateFlats: null, ages: { children: null, working: null, older: null },
    features, repairs: [], wear: {}, plans: [], plansAvailable: false };
}

export function parseGorodPlans(html: string): BuildingProfile['plans'] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const section = Array.from(doc.querySelectorAll('.accordion')).find((s) => /Региональная программа капитального ремонта/.test(text(s.querySelector('.accordion__name'))));
  if (!section) return [];
  return Array.from(section.querySelectorAll('.program-tile')).flatMap((tile) => {
    const work = text(tile.querySelector('.program-tile__title-text'));
    const period = text(tile.querySelector('.program-tile__value')).match(/\b(19\d{2}|20\d{2})\b/g)?.map(Number) ?? [];
    return work && !/проектн.*документ|смет/i.test(work) && period.length > 0
      ? [{ work, startYear: period[0], endYear: period.at(-1)! }] : [];
  });
}
