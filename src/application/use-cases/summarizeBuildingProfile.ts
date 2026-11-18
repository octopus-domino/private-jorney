import type { BuildingProfile } from '../../domain/BuildingProfile';
import { maintenanceCategory, MAINTENANCE_LABELS, WEAR_LABELS } from '../../domain/maintenancePolicy';
import { summarizeBuildingMaintenance } from './summarizeBuildingMaintenance';

export interface BuildingFact { label: string; value: string; detail?: string }
export const BUILDING_CRITERIA = 'Оценка потребности в капремонте: СП 547.1325800.2025, п. 6.1, с округлением исходного износа до целого по п. 6.5: до 30% — капремонт не требуется, до 50% — требуется, до 65% — приоритетный ремонт, выше — инструментальное обследование. Слова о степени износа — понятные подписи этих диапазонов. Применяем их к опубликованным показателям элементов, без нового обследования и вывода о безопасности дома. Газ и лифты исключены из этой шкалы. Даты работ не определяют их необходимость. Жителей: до 100 — немного, до 300 — среднее число, больше — много; это условная шкала приложения, а не строительный норматив. Возрастные доли рассчитаны по опубликованным группам; заметная доля детей — от одной пятой, много старших — от одной трети. Возраст старше трудоспособного не подтверждает получение пенсии.';

export function summarizeBuildingProfile(profile: BuildingProfile, year = new Date().getFullYear()): BuildingFact[] {
  const facts: BuildingFact[] = [];
  const { residents, floors, communalFlats, yearBuilt } = profile;
  if (residents && residents > 0) facts.push({ label: 'Жители', value: residents < 100 ? 'Немного жителей' : residents < 300 ? 'Среднее число жителей' : 'Много жителей', detail: `В паспорте указано ${residents} человек.` });
  if ((floors && floors > 0) || (yearBuilt && yearBuilt > 0)) {
    facts.push({ label: 'Дом', value: [floors ? `${floors} этажей` : '', yearBuilt ? yearBuilt < 1917 ? 'Дореволюционная постройка' : yearBuilt >= 2000 ? 'Постройка XXI века' : 'Постройка XX века' : ''].filter(Boolean).join(' · '), detail: yearBuilt ? `Год постройки: ${yearBuilt}. Материалы и сохранившийся интерьер оцениваются по отдельным сведениям.` : undefined });
  }
  if (communalFlats && communalFlats > 0) facts.push({ label: 'Коммунальные квартиры', value: 'Есть коммунальные квартиры', detail: `${communalFlats} квартир коммунального заселения${profile.separateFlats ? ` из ${communalFlats + profile.separateFlats}` : ''}.` });

  const repairs = profile.repairs.filter((r) => r.year <= year && r.year >= 1800 && !/проект|смет|прибор.*уч[её]т/i.test(r.work)).sort((a, b) => b.year - a.year);
  const knownWear: number[] = [];
  for (const [label, pattern, keys] of [
    ['Крыша', /крыш|кровл/i, ['Кровля', 'Крыша']],
    ['Вода и канализация', /водоснабжен|канализац/i, ['Система ХВС', 'Система ГВС', 'Система канализации']],
    ['Отопление', /отоплен|теплоснабжен/i, ['Центральное отопление']],
    ['Электрика', /электроснабжен|электрооборуд/i, ['Электрооборудование']],
  ] as const) {
    const values = keys.map((key) => ({ key, wear: profile.wear[key] })).filter((v) => maintenanceCategory(v.wear) !== null);
    const wear = values.length ? Math.max(...values.map((v) => v.wear)) : null;
    const category = wear === null ? null : maintenanceCategory(wear);
    const repair = repairs.find((r) => pattern.test(r.work));
    const plans = profile.plans.filter((p) => pattern.test(p.work) && p.endYear >= year);
    if (wear !== null) knownWear.push(wear);
    if (!category && !repair && !plans.length) continue;
    facts.push({ label, value: category ? WEAR_LABELS[category] : repair ? 'Есть сведения о ремонте' : 'Есть в программе ремонта', detail: [
      category ? `${MAINTENANCE_LABELS[category]} (СП 547.1325800.2025, п. 6.1).` : 'Состояние по опубликованным данным определить нельзя.',
      ...values.map((v) => `${v.key}: износ ${v.wear}%.`),
      repair ? `Запись о работах: ${repair.year}, ${repair.work}. Ремонт не означает полную замену элемента.` : '',
      ...plans.map((p) => `В программе: ${p.work}, ${p.startYear}–${p.endYear}. Выполнение не подтверждено.`),
    ].filter(Boolean).join(' ') });
  }

  // Evaluate every applicable published element, not only the visible roof/services.
  const applicable = Object.entries(profile.wear).filter(([name, wear]) => !/газ|лифт/i.test(name) && maintenanceCategory(wear) !== null);
  knownWear.push(...applicable.map(([, wear]) => wear));
  const highest = knownWear.length ? maintenanceCategory(Math.max(...knownWear)) : null;
  if (highest || repairs.length || profile.plans.length) facts.push({ label: 'Капремонт', value: highest ? highest === 1 ? 'По известным показателям пока не требуется' : highest === 2 ? 'Есть элементы, которым нужен ремонт' : highest === 3 ? 'Есть элементы для приоритетного ремонта' : 'Есть элементы, требующие обследования' : 'Недостаточно данных для оценки необходимости', detail: [
    'Вывод по наиболее изношенному из опубликованных элементов; пропущенные и нулевые показатели не участвуют. Это не официальное заключение об обследовании.',
    ...applicable.filter(([, wear]) => maintenanceCategory(wear) === highest).map(([name]) => `${name}.`),
    ...repairs.slice(0, 3).map((r) => `Записи о ремонте в паспорте: ${r.year}, ${r.work}.`),
    ...profile.plans.filter((p) => p.endYear >= year).slice(0, 3).map((p) => `В программе: ${p.work}, ${p.startYear}–${p.endYear}.`),
    'Включение в программу не подтверждает выполнение ремонта.',
  ].join(' ') });

  if (profile.maintenance) facts.push(...summarizeBuildingMaintenance(profile.maintenance));
  for (const feature of profile.features) facts.push(feature);
  const ages = profile.ages;
  if (ages.children !== null && ages.working !== null && ages.older !== null) {
    const total = ages.children + ages.working + ages.older;
    if (total > 0) {
      const groups = [{ name: 'дети и подростки', n: ages.children }, { name: 'взрослые трудоспособного возраста', n: ages.working }, { name: 'жители старше трудоспособного возраста', n: ages.older }].filter((g) => g.n > 0);
      const description = [ages.older / total >= 1 / 3 ? 'Много жителей старше трудоспособного возраста' : '', ages.children / total >= 0.2 ? 'Заметная доля детей и подростков' : '', ages.working / total > 0.5 ? 'Большинство — взрослые трудоспособного возраста' : ''].filter(Boolean);
      const pct = (n: number) => Math.round(n / total * 100) || 'меньше 1';
      facts.push({ label: 'Кто живёт в доме', value: description.join('. ') || 'Жители разных возрастных групп', detail: `${groups.map((g) => `${g.name}: ${g.n} человек, ${pct(g.n)}%`).join('; ')}. Всего в возрастной таблице ${total} человек.${residents && residents !== total ? ' Возрастная таблица и общее число жителей в паспорте различаются.' : ''} Число семей и доля молодёжи отдельно не опубликованы.` });
    }
  }
  return facts;
}
