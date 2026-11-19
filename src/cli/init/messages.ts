// Texts of the init wizard in its 7 languages (04-REQ-43, D-27): questions, lessons, the summary
// and the manual instructions. Every language has the same keys and the same {placeholders}.
// Codes (INIT_*), file and option names, the written files and the other commands stay English.
// Pure.

export const LANGUAGES = ['en', 'es', 'fr', 'pl', 'it', 'uk', 'ru'] as const;
export type WizardLanguage = (typeof LANGUAGES)[number];

/** Names of the languages in themselves, shown in step 0. */
export const LANGUAGE_NAMES: Record<WizardLanguage, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  pl: 'Polski',
  it: 'Italiano',
  uk: 'Українська',
  ru: 'Русский',
};

export function isWizardLanguage(value: string): value is WizardLanguage {
  return (LANGUAGES as readonly string[]).includes(value);
}

const en = {
  declinedInstalled: '{pkg} is installed; no file was changed.',
  declinedSteps: 'To set it up by hand:',
  declinedConfig: 'Wrap the exported config in playwright.config with withPerf() from {config}.',
  declinedTest:
    'Wrap your test object with withPerfFixtures() from {fixture}, or import test from {test} instead of @playwright/test.',
  declinedRun:
    'Run {thresholds} and commit the perf-thresholds.*.json files, then {test} runs the measurement.',
  declinedDocs: 'Guide: {url}',
  declinedLater: 'Run {init} any time for the guided setup.',

  noTerminal:
    'no terminal: the default answers are used and nothing is written (like --dry-run). Use --yes to write the changes.',
  dryRun: 'dry run: the planned changes are shown and nothing is written.',
  interrupted: 'interrupted.',
  answerAgain: 'Please answer again: that value is not valid here.',
  pressEnter: 'Press Enter to continue.',
  yes: 'yes',
  no: 'no',
  yesShort: 'y',
  noShort: 'n',

  stepProject: 'Project',
  projectLine: '{config} · Playwright {version} · {manager} · {modules}',
  versionUnknown: 'version unknown',
  testDirLine:
    'Test directory "{dir}" · files importing @playwright/test: {imports} · files calling .extend(): {extend}',
  projectsPart: 'projects {names}',
  ciLine: 'CI: {platform}',
  ciNone: 'none found',
  alreadySetUp: 'Already set up: {items}',
  measuredTestObject: 'measured test object',

  stepHow: 'How it works',
  how1: 'Measurement runs are separate from your usual test runs: "{test}" runs the tests in perf mode.',
  how2: 'Every test runs several times in one worker, so each backend request gets enough samples.',
  how3: 'Requests are grouped into endpoint keys such as "GET api /users/:id".',
  how4: '"{thresholds}" derives thresholds per key into files you commit to the repository.',
  how5: 'Exit code 0 means ok, 2 a performance regression, 3 a tool or config error.',

  stepBackend: 'Backend',
  backendLesson: 'Endpoint keys start with a short label of the backend origin.',
  noBaseUrl: 'No baseURL found in playwright.config: requests are labeled with their host.',
  labelQuestion: 'Label for {origin}?',

  stepTests: 'Which tests',
  testsLesson:
    'A measurement run takes about (tests × repetitions) test runs on 1 worker, so measure the tests that call the important backend endpoints.',
  taggedFiles: 'Files with tests tagged @perf: {count}.',
  noTaggedMessage: 'No test is tagged @perf, so all tests are proposed.',
  noTaggedHint:
    "Tag the tests to measure with test('title', { tag: '@perf' }, ...), then choose @perf.",
  scopeQuestion: 'Measure all tests or only tests tagged @perf? [{all}/@perf]',
  scopeAll: 'all',

  stepRepeat: 'Repetitions',
  repeatLesson:
    'Each rule needs a minimum number of samples per endpoint (minSamples), and samples are calls per test × tests × repetitions.',
  repeatQuestion: 'Repetitions per test in measurement runs?',

  stepTrial: 'Trial period',
  trialLesson:
    'In warn-only mode regressions are reported but do not fail the run, so you can watch the results for a few weeks before they block builds.',
  warnOnlyQuestion: 'Start in warn-only mode for the first weeks?',

  stepEnvs: 'Environments',
  envsLesson:
    'Each environment gets its own thresholds files (perf-thresholds.<kind>.<label>.json).',
  envsQuestion: 'Do you run against several environments?',
  envLabelsQuestion: 'Environment labels, separated by commas?',
  none: 'none',

  stepCi: 'CI',
  ciLesson: 'A CI job runs the measurement on pull requests and every night and keeps the report.',
  noCi: 'No CI configuration found. Recipes for GitHub Actions, GitLab CI, Jenkins and Azure Pipelines: {url}',
  ciQuestion: 'Add a CI job for measurement runs ({platform})?',

  stepChanges: 'Changes',
  nothingToChange: 'Nothing to change: the project is already set up for these answers.',
  changesLesson: 'Each change is shown as a diff before it is applied.',
  newFile: 'new file',
  modifiedFile: 'change',
  overwriteQuestion: '{path} exists. Overwrite it?',
  keptWithYes: '{path} exists and is kept (--yes does not overwrite it).',
  kept: '{path} exists and is kept.',
  applyQuestion: 'Apply this change?',
  fileWritten: 'Written: {path}',

  stepFirstRun: 'First measurement',
  firstRunLesson:
    'A thresholds run measures the tests and writes the thresholds files and the report ({dir}/).',
  firstRunLaptop:
    'Thresholds measured on a laptop do not fit CI machines: derive the committed ones in CI.',
  firstRunQuestion: 'Run a first thresholds run now?',
  skipped: 'Skipped.',

  stepSummary: 'Summary',
  changedFiles: 'Changed files:',
  noFilesChanged: 'No files were changed.',
  plannedChanges: 'Planned changes (not written):',
  manualSteps: 'Manual steps: {count} (see the warnings above).',
  nextSteps: 'Next steps:',
  nextThresholds:
    '{command}: derive the thresholds and commit the perf-thresholds.*.json files (derive them on the CI machines for stable values).',
  nextTest: '{command}: a measurement run that fails on a regression.',
  nextJenkins: 'Create a Pipeline job in Jenkins with the script path {path}.',
  nextAzure: 'Create a pipeline in Azure DevOps from {path}.',
  nextWarnOnly: 'After the trial period remove gate.warnOnly from pw-perf.config.ts.',
  nextApply: 'Apply the changes above (run init again in a terminal or with --yes).',
  docs: 'Docs: {links}',
  finished: 'Setup finished.',

  noConfigMessage: 'No playwright.config.* in {dir}.',
  noConfigHint:
    'Run "{command} init" in the directory of playwright.config (in a monorepo: the package with the Playwright tests).',
  tooOldMessage:
    '@playwright/test {version} is older than {min}, the lowest version {pkg} supports.',
  tooOldHint: 'Update @playwright/test to {min} or later, then run "{command} init" again.',
  writeFailedMessage: 'Could not write {detail}',
  writeFailedHint: 'Check the permissions of the file and its directory, then run init again.',

  manualPerfConfigKept: '{file} exists and was not changed.',
  manualPerfConfigHint: 'Set these options in it if you want them:',
  manualConfigJson: '{config} was not changed: the package config is {file}.',
  manualConfigPattern:
    '{config} was not changed: its export is not a plain defineConfig({...}) or object (for example another wrapper).',
  configHintIntro:
    'Wrap the exported config in withPerf() as the outermost call (also around other wrappers):',
  configHintCjs: 'In {path} with module.exports: {call}.',
  testHintIntro:
    "Wrap every test object used by browser tests in withPerfFixtures() from '{entry}':",
  testHintMerge:
    'Wrap the result of mergeTests() and the test passed to createBdd() (playwright-bdd).',
  testHintImport:
    "Tests that import test from @playwright/test can import it from '{entry}' instead.",
  manualNoTestObject:
    'No test object was found to measure: no file imports test from @playwright/test.',
  manualTestObjectOne: '{files} was not changed:',
  manualTestObjectMany: '{files} were not changed:',
  testObjectsReason:
    'the test objects are not one `export const test = base.extend(...)` (several test objects, mergeTests() or another layout).',
  manualNoPackageJson: 'package.json was not found.',
  addScripts: 'Add these scripts:',
  manualScriptExists: 'package.json: the script "{name}" exists and was not changed.',
  manualScriptHint:
    'The wizard would add "{name}": "{command}". Rename one of them, or add the command by hand.',
  manualPackageJsonInvalid:
    'package.json was not changed: it is not a JSON object with a "scripts" object.',
  manualCiKept: '{file} exists and was not changed.',
  manualCiHint: 'Compare it with examples/ci/ in the {pkg} repository.',
  manualGitlabInclude: '.gitlab-ci.yml was not changed: include the new job file in it.',
  manualNpmOne: '{files} installs the dependencies with npm.',
  manualNpmMany: '{files} install the dependencies with npm.',
  manualNpmHint:
    'This project uses {manager}: replace "npm ci" with "{install}" and "npx" with "{npx}".',
};

export type MessageKey = keyof typeof en;
type Messages = Record<MessageKey, string>;

const pl: Messages = {
  declinedInstalled: '{pkg} jest zainstalowana; żaden plik nie został zmieniony.',
  declinedSteps: 'Konfiguracja ręczna:',
  declinedConfig: 'Owiń eksportowaną konfigurację w playwright.config w withPerf() z {config}.',
  declinedTest:
    'Owiń swój obiekt test w withPerfFixtures() z {fixture} albo importuj test z {test} zamiast z @playwright/test.',
  declinedRun:
    'Uruchom {thresholds} i zacommituj pliki perf-thresholds.*.json, potem {test} wykonuje pomiar.',
  declinedDocs: 'Przewodnik: {url}',
  declinedLater: 'Konfigurację z przewodnikiem uruchomisz w każdej chwili poleceniem {init}.',

  noTerminal:
    'brak terminala: kreator przyjmuje odpowiedzi domyślne i niczego nie zapisuje (jak --dry-run). Użyj --yes, aby zapisać zmiany.',
  dryRun: 'tryb --dry-run: kreator pokazuje planowane zmiany i niczego nie zapisuje.',
  interrupted: 'przerwano.',
  answerAgain: 'Odpowiedz jeszcze raz: ta wartość nie jest tu poprawna.',
  pressEnter: 'Naciśnij Enter, aby kontynuować.',
  yes: 'tak',
  no: 'nie',
  yesShort: 't',
  noShort: 'n',

  stepProject: 'Projekt',
  projectLine: '{config} · Playwright {version} · {manager} · {modules}',
  versionUnknown: 'wersja nieznana',
  testDirLine:
    'Katalog testów "{dir}" · pliki z importem @playwright/test: {imports} · pliki z wywołaniem .extend(): {extend}',
  projectsPart: 'projekty {names}',
  ciLine: 'CI: {platform}',
  ciNone: 'nie znaleziono',
  alreadySetUp: 'Już skonfigurowane: {items}',
  measuredTestObject: 'mierzony obiekt test',

  stepHow: 'Jak to działa',
  how1: 'Pomiary to osobne przebiegi, niezależne od zwykłych testów: "{test}" uruchamia testy w trybie pomiarowym.',
  how2: 'Każdy test wykonuje się kilka razy w jednym workerze, więc każde żądanie do backendu ma dość próbek.',
  how3: 'Żądania są grupowane w klucze endpointów, np. "GET api /users/:id".',
  how4: '"{thresholds}" wyznacza progi dla każdego klucza i zapisuje je w plikach, które commitujesz do repozytorium.',
  how5: 'Kod wyjścia 0 oznacza sukces, 2 regresję wydajności, 3 błąd narzędzia albo konfiguracji.',

  stepBackend: 'Backend',
  backendLesson: 'Klucze endpointów zaczynają się od krótkiej etykiety originu backendu.',
  noBaseUrl: 'Brak baseURL w playwright.config: żądania będą oznaczone nazwą hosta.',
  labelQuestion: 'Etykieta dla {origin}?',

  stepTests: 'Które testy',
  testsLesson:
    'Pomiar trwa mniej więcej tyle, co (testy × powtórzenia) uruchomień testów na 1 workerze, więc mierz testy, które wywołują ważne endpointy backendu.',
  taggedFiles: 'Pliki z testami oznaczonymi @perf: {count}.',
  noTaggedMessage: 'Żaden test nie ma tagu @perf, więc proponowane są wszystkie testy.',
  noTaggedHint:
    "Oznacz testy do pomiaru: test('tytuł', { tag: '@perf' }, ...), a potem wybierz @perf.",
  scopeQuestion: 'Mierzyć wszystkie testy czy tylko oznaczone @perf? [{all}/@perf]',
  scopeAll: 'wszystkie',

  stepRepeat: 'Powtórzenia',
  repeatLesson:
    'Każda reguła potrzebuje minimalnej liczby próbek na endpoint (minSamples), a próbek jest: wywołania w teście × testy × powtórzenia.',
  repeatQuestion: 'Ile powtórzeń każdego testu w pomiarze?',

  stepTrial: 'Okres próbny',
  trialLesson:
    'W trybie warn-only regresje są zgłaszane, ale przebieg nie kończy się błędem, więc przez kilka tygodni możesz obserwować wyniki, zanim zaczną blokować buildy.',
  warnOnlyQuestion: 'Zacząć w trybie warn-only przez pierwsze tygodnie?',

  stepEnvs: 'Środowiska',
  envsLesson: 'Każde środowisko ma własne pliki progów (perf-thresholds.<kind>.<label>.json).',
  envsQuestion: 'Czy testujesz kilka środowisk?',
  envLabelsQuestion: 'Etykiety środowisk, oddzielone przecinkami?',
  none: 'brak',

  stepCi: 'CI',
  ciLesson: 'Job CI uruchamia pomiar w pull requestach i co noc oraz zachowuje raport.',
  noCi: 'Nie znaleziono konfiguracji CI. Przepisy dla GitHub Actions, GitLab CI, Jenkinsa i Azure Pipelines: {url}',
  ciQuestion: 'Dodać job CI z pomiarami ({platform})?',

  stepChanges: 'Zmiany',
  nothingToChange: 'Nic do zmiany: projekt jest już skonfigurowany dla tych odpowiedzi.',
  changesLesson: 'Każda zmiana jest najpierw pokazana jako diff, a dopiero potem zastosowana.',
  newFile: 'nowy plik',
  modifiedFile: 'zmiana',
  overwriteQuestion: '{path} już istnieje. Nadpisać go?',
  keptWithYes: '{path} już istnieje i zostaje bez zmian (--yes go nie nadpisuje).',
  kept: '{path} już istnieje i zostaje bez zmian.',
  applyQuestion: 'Zastosować tę zmianę?',
  fileWritten: 'Zapisano: {path}',

  stepFirstRun: 'Pierwszy pomiar',
  firstRunLesson:
    'Przebieg w trybie thresholds mierzy testy i zapisuje pliki progów oraz raport ({dir}/).',
  firstRunLaptop:
    'Progi zmierzone na laptopie nie pasują do maszyn CI: te, które commitujesz, wyznacz w CI.',
  firstRunQuestion: 'Uruchomić teraz pierwszy przebieg thresholds?',
  skipped: 'Pominięto.',

  stepSummary: 'Podsumowanie',
  changedFiles: 'Zmienione pliki:',
  noFilesChanged: 'Żaden plik nie został zmieniony.',
  plannedChanges: 'Planowane zmiany (niezapisane):',
  manualSteps: 'Kroki ręczne: {count} (zobacz ostrzeżenia powyżej).',
  nextSteps: 'Następne kroki:',
  nextThresholds:
    '{command}: wyznacz progi i zacommituj pliki perf-thresholds.*.json (wyznaczaj je na maszynach CI, żeby wartości były stabilne).',
  nextTest: '{command}: pomiar, który kończy się błędem przy regresji.',
  nextJenkins: 'Utwórz w Jenkinsie job typu Pipeline ze ścieżką skryptu {path}.',
  nextAzure: 'Utwórz w Azure DevOps pipeline z pliku {path}.',
  nextWarnOnly: 'Po okresie próbnym usuń gate.warnOnly z pw-perf.config.ts.',
  nextApply: 'Zastosuj powyższe zmiany (uruchom init ponownie w terminalu albo z --yes).',
  docs: 'Dokumentacja: {links}',
  finished: 'Konfiguracja zakończona.',

  noConfigMessage: 'Brak playwright.config.* w {dir}.',
  noConfigHint:
    'Uruchom "{command} init" w katalogu z playwright.config (w monorepo: w pakiecie z testami Playwrighta).',
  tooOldMessage:
    '@playwright/test {version} jest starszy niż {min}, najniższa wersja obsługiwana przez {pkg}.',
  tooOldHint:
    'Zaktualizuj @playwright/test do {min} lub nowszej, potem uruchom ponownie "{command} init".',
  writeFailedMessage: 'Nie udało się zapisać {detail}',
  writeFailedHint: 'Sprawdź uprawnienia pliku i jego katalogu, potem uruchom init ponownie.',

  manualPerfConfigKept: '{file} już istnieje i nie został zmieniony.',
  manualPerfConfigHint: 'Ustaw w nim te opcje, jeśli ich potrzebujesz:',
  manualConfigJson: 'Nie zmieniono {config}: konfiguracja paczki jest w {file}.',
  manualConfigPattern:
    'Nie zmieniono {config}: eksportuje coś innego niż zwykłe defineConfig({...}) albo obiekt (np. inny wrapper).',
  configHintIntro:
    'Owiń eksportowaną konfigurację w withPerf() jako najbardziej zewnętrzne wywołanie (także wokół innych wrapperów):',
  configHintCjs: 'W {path} z module.exports: {call}.',
  testHintIntro:
    "Owiń każdy obiekt test używany przez testy przeglądarkowe w withPerfFixtures() z '{entry}':",
  testHintMerge: 'Owiń wynik mergeTests() oraz test przekazywany do createBdd() (playwright-bdd).',
  testHintImport:
    "Testy, które importują test z @playwright/test, mogą zamiast tego importować go z '{entry}'.",
  manualNoTestObject:
    'Nie znaleziono obiektu test do pomiaru: żaden plik nie importuje test z @playwright/test.',
  manualTestObjectOne: 'Nie zmieniono {files}:',
  manualTestObjectMany: 'Nie zmieniono {files}:',
  testObjectsReason:
    'obiekty test to nie jedno `export const test = base.extend(...)` (kilka obiektów test, mergeTests() albo inny układ).',
  manualNoPackageJson: 'Nie znaleziono package.json.',
  addScripts: 'Dodaj te skrypty:',
  manualScriptExists: 'package.json: skrypt "{name}" już istnieje i nie został zmieniony.',
  manualScriptHint:
    'Kreator dodałby "{name}": "{command}". Zmień nazwę jednego z nich albo dodaj polecenie ręcznie.',
  manualPackageJsonInvalid:
    'Nie zmieniono package.json: to nie jest obiekt JSON z obiektem "scripts".',
  manualCiKept: '{file} już istnieje i nie został zmieniony.',
  manualCiHint: 'Porównaj go z examples/ci/ w repozytorium {pkg}.',
  manualGitlabInclude: 'Nie zmieniono .gitlab-ci.yml: dołącz do niego nowy plik joba.',
  manualNpmOne: '{files} instaluje zależności przez npm.',
  manualNpmMany: '{files} instalują zależności przez npm.',
  manualNpmHint: 'Ten projekt używa {manager}: zamień "npm ci" na "{install}", a "npx" na "{npx}".',
};

const es: Messages = {
  declinedInstalled: '{pkg} está instalado; no se modificó ningún archivo.',
  declinedSteps: 'Para configurarlo a mano:',
  declinedConfig:
    'Envuelve la configuración exportada en playwright.config con withPerf() de {config}.',
  declinedTest:
    'Envuelve tu objeto test con withPerfFixtures() de {fixture}, o importa test de {test} en lugar de @playwright/test.',
  declinedRun:
    'Ejecuta {thresholds} y sube los archivos perf-thresholds.*.json; después {test} ejecuta la medición.',
  declinedDocs: 'Guía: {url}',
  declinedLater: 'Ejecuta {init} cuando quieras para la configuración guiada.',

  noTerminal:
    'sin terminal: se usan las respuestas por defecto y no se escribe nada (como --dry-run). Usa --yes para escribir los cambios.',
  dryRun: 'simulación: se muestran los cambios previstos y no se escribe nada.',
  interrupted: 'interrumpido.',
  answerAgain: 'Responde de nuevo: ese valor no es válido aquí.',
  pressEnter: 'Pulsa Enter para continuar.',
  yes: 'sí',
  no: 'no',
  yesShort: 's',
  noShort: 'n',

  stepProject: 'Proyecto',
  projectLine: '{config} · Playwright {version} · {manager} · {modules}',
  versionUnknown: 'versión desconocida',
  testDirLine:
    'Directorio de tests "{dir}" · archivos que importan @playwright/test: {imports} · archivos que llaman a .extend(): {extend}',
  projectsPart: 'proyectos {names}',
  ciLine: 'CI: {platform}',
  ciNone: 'no encontrado',
  alreadySetUp: 'Ya configurado: {items}',
  measuredTestObject: 'objeto test medido',

  stepHow: 'Cómo funciona',
  how1: 'Las mediciones son ejecuciones aparte de tus tests habituales: "{test}" ejecuta los tests en modo perf.',
  how2: 'Cada test se ejecuta varias veces en un worker, para que cada petición al backend tenga suficientes muestras.',
  how3: 'Las peticiones se agrupan en claves de endpoint como "GET api /users/:id".',
  how4: '"{thresholds}" calcula umbrales por clave en archivos que subes al repositorio.',
  how5: 'Código de salida 0: todo bien; 2: regresión de rendimiento; 3: error de la herramienta o de la configuración.',

  stepBackend: 'Backend',
  backendLesson: 'Las claves de endpoint empiezan con una etiqueta corta del origen del backend.',
  noBaseUrl: 'No hay baseURL en playwright.config: las peticiones se etiquetan con su host.',
  labelQuestion: '¿Etiqueta para {origin}?',

  stepTests: 'Qué tests',
  testsLesson:
    'Una medición dura unas (tests × repeticiones) ejecuciones de tests en 1 worker, así que mide los tests que llaman a los endpoints importantes del backend.',
  taggedFiles: 'Archivos con tests etiquetados @perf: {count}.',
  noTaggedMessage: 'Ningún test tiene la etiqueta @perf, así que se proponen todos los tests.',
  noTaggedHint:
    "Etiqueta los tests a medir con test('título', { tag: '@perf' }, ...) y luego elige @perf.",
  scopeQuestion: '¿Medir todos los tests o solo los etiquetados @perf? [{all}/@perf]',
  scopeAll: 'todos',

  stepRepeat: 'Repeticiones',
  repeatLesson:
    'Cada regla necesita un mínimo de muestras por endpoint (minSamples), y las muestras son llamadas por test × tests × repeticiones.',
  repeatQuestion: '¿Repeticiones por test en las mediciones?',

  stepTrial: 'Periodo de prueba',
  trialLesson:
    'En modo warn-only las regresiones se notifican pero no hacen fallar la ejecución, así puedes observar los resultados unas semanas antes de que bloqueen los builds.',
  warnOnlyQuestion: '¿Empezar en modo warn-only las primeras semanas?',

  stepEnvs: 'Entornos',
  envsLesson:
    'Cada entorno tiene sus propios archivos de umbrales (perf-thresholds.<kind>.<label>.json).',
  envsQuestion: '¿Ejecutas contra varios entornos?',
  envLabelsQuestion: '¿Etiquetas de los entornos, separadas por comas?',
  none: 'ninguno',

  stepCi: 'CI',
  ciLesson:
    'Un job de CI ejecuta la medición en los pull requests y cada noche, y guarda el informe.',
  noCi: 'No se encontró configuración de CI. Recetas para GitHub Actions, GitLab CI, Jenkins y Azure Pipelines: {url}',
  ciQuestion: '¿Añadir un job de CI para las mediciones ({platform})?',

  stepChanges: 'Cambios',
  nothingToChange: 'Nada que cambiar: el proyecto ya está configurado para estas respuestas.',
  changesLesson: 'Cada cambio se muestra como diff antes de aplicarlo.',
  newFile: 'archivo nuevo',
  modifiedFile: 'cambio',
  overwriteQuestion: '{path} ya existe. ¿Sobrescribirlo?',
  keptWithYes: '{path} ya existe y se conserva (--yes no lo sobrescribe).',
  kept: '{path} ya existe y se conserva.',
  applyQuestion: '¿Aplicar este cambio?',
  fileWritten: 'Escrito: {path}',

  stepFirstRun: 'Primera medición',
  firstRunLesson:
    'Una ejecución thresholds mide los tests y escribe los archivos de umbrales y el informe ({dir}/).',
  firstRunLaptop:
    'Los umbrales medidos en un portátil no sirven para las máquinas de CI: calcula en CI los que subes al repositorio.',
  firstRunQuestion: '¿Lanzar ahora una primera ejecución thresholds?',
  skipped: 'Omitido.',

  stepSummary: 'Resumen',
  changedFiles: 'Archivos modificados:',
  noFilesChanged: 'No se modificó ningún archivo.',
  plannedChanges: 'Cambios previstos (no escritos):',
  manualSteps: 'Pasos manuales: {count} (ver las advertencias de arriba).',
  nextSteps: 'Siguientes pasos:',
  nextThresholds:
    '{command}: calcula los umbrales y sube los archivos perf-thresholds.*.json (calcúlalos en las máquinas de CI para tener valores estables).',
  nextTest: '{command}: una medición que falla ante una regresión.',
  nextJenkins: 'Crea un job Pipeline en Jenkins con la ruta de script {path}.',
  nextAzure: 'Crea un pipeline en Azure DevOps a partir de {path}.',
  nextWarnOnly: 'Tras el periodo de prueba, quita gate.warnOnly de pw-perf.config.ts.',
  nextApply: 'Aplica los cambios de arriba (ejecuta init de nuevo en un terminal o con --yes).',
  docs: 'Documentación: {links}',
  finished: 'Configuración terminada.',

  noConfigMessage: 'No hay playwright.config.* en {dir}.',
  noConfigHint:
    'Ejecuta "{command} init" en el directorio de playwright.config (en un monorepo: el paquete con los tests de Playwright).',
  tooOldMessage:
    '@playwright/test {version} es anterior a {min}, la versión mínima que admite {pkg}.',
  tooOldHint: 'Actualiza @playwright/test a {min} o posterior y ejecuta "{command} init" de nuevo.',
  writeFailedMessage: 'No se pudo escribir {detail}',
  writeFailedHint: 'Revisa los permisos del archivo y de su directorio y ejecuta init de nuevo.',

  manualPerfConfigKept: '{file} ya existe y no se modificó.',
  manualPerfConfigHint: 'Define en él estas opciones si las quieres:',
  manualConfigJson: '{config} no se modificó: la configuración del paquete es {file}.',
  manualConfigPattern:
    '{config} no se modificó: su export no es un defineConfig({...}) simple ni un objeto (por ejemplo, hay otro wrapper).',
  configHintIntro:
    'Envuelve la configuración exportada en withPerf() como llamada más externa (también alrededor de otros wrappers):',
  configHintCjs: 'En {path} con module.exports: {call}.',
  testHintIntro:
    "Envuelve cada objeto test usado por los tests de navegador en withPerfFixtures() de '{entry}':",
  testHintMerge:
    'Envuelve el resultado de mergeTests() y el test que se pasa a createBdd() (playwright-bdd).',
  testHintImport:
    "Los tests que importan test de @playwright/test pueden importarlo de '{entry}' en su lugar.",
  manualNoTestObject:
    'No se encontró ningún objeto test que medir: ningún archivo importa test de @playwright/test.',
  manualTestObjectOne: '{files} no se modificó:',
  manualTestObjectMany: '{files} no se modificaron:',
  testObjectsReason:
    'los objetos test no son un único `export const test = base.extend(...)` (varios objetos test, mergeTests() u otra estructura).',
  manualNoPackageJson: 'No se encontró package.json.',
  addScripts: 'Añade estos scripts:',
  manualScriptExists: 'package.json: el script "{name}" ya existe y no se modificó.',
  manualScriptHint:
    'El asistente añadiría "{name}": "{command}". Renombra uno de los dos o añade el comando a mano.',
  manualPackageJsonInvalid:
    'package.json no se modificó: no es un objeto JSON con un objeto "scripts".',
  manualCiKept: '{file} ya existe y no se modificó.',
  manualCiHint: 'Compáralo con examples/ci/ del repositorio de {pkg}.',
  manualGitlabInclude: '.gitlab-ci.yml no se modificó: incluye en él el nuevo archivo del job.',
  manualNpmOne: '{files} instala las dependencias con npm.',
  manualNpmMany: '{files} instalan las dependencias con npm.',
  manualNpmHint:
    'Este proyecto usa {manager}: sustituye "npm ci" por "{install}" y "npx" por "{npx}".',
};

const fr: Messages = {
  declinedInstalled: '{pkg} est installé ; aucun fichier n’a été modifié.',
  declinedSteps: 'Pour le configurer à la main :',
  declinedConfig:
    'Enveloppez la configuration exportée de playwright.config dans withPerf() de {config}.',
  declinedTest:
    'Enveloppez votre objet test dans withPerfFixtures() de {fixture}, ou importez test depuis {test} au lieu de @playwright/test.',
  declinedRun:
    'Lancez {thresholds} et committez les fichiers perf-thresholds.*.json, puis {test} lance la mesure.',
  declinedDocs: 'Guide : {url}',
  declinedLater: 'Lancez {init} à tout moment pour la configuration guidée.',

  noTerminal:
    "pas de terminal : les réponses par défaut sont utilisées et rien n'est écrit (comme --dry-run). Utilisez --yes pour écrire les modifications.",
  dryRun: "simulation : les modifications prévues sont affichées et rien n'est écrit.",
  interrupted: 'interrompu.',
  answerAgain: "Répondez à nouveau : cette valeur n'est pas valide ici.",
  pressEnter: 'Appuyez sur Entrée pour continuer.',
  yes: 'oui',
  no: 'non',
  yesShort: 'o',
  noShort: 'n',

  stepProject: 'Projet',
  projectLine: '{config} · Playwright {version} · {manager} · {modules}',
  versionUnknown: 'version inconnue',
  testDirLine:
    'Répertoire des tests "{dir}" · fichiers qui importent @playwright/test : {imports} · fichiers qui appellent .extend() : {extend}',
  projectsPart: 'projets {names}',
  ciLine: 'CI : {platform}',
  ciNone: 'aucune trouvée',
  alreadySetUp: 'Déjà configuré : {items}',
  measuredTestObject: 'objet test mesuré',

  stepHow: 'Fonctionnement',
  how1: 'Les mesures sont des exécutions séparées de vos tests habituels : "{test}" lance les tests en mode perf.',
  how2: 'Chaque test tourne plusieurs fois dans un seul worker, pour que chaque requête au backend ait assez d’échantillons.',
  how3: 'Les requêtes sont regroupées en clés d’endpoint comme "GET api /users/:id".',
  how4: '"{thresholds}" calcule des seuils par clé dans des fichiers que vous committez dans le dépôt.',
  how5: 'Code de sortie 0 : tout va bien, 2 : régression de performance, 3 : erreur de l’outil ou de la configuration.',

  stepBackend: 'Backend',
  backendLesson: 'Les clés d’endpoint commencent par un court libellé de l’origine du backend.',
  noBaseUrl: 'Aucun baseURL dans playwright.config : les requêtes sont libellées avec leur hôte.',
  labelQuestion: 'Libellé pour {origin} ?',

  stepTests: 'Quels tests',
  testsLesson:
    'Une mesure prend environ (tests × répétitions) exécutions de tests sur 1 worker : mesurez donc les tests qui appellent les endpoints importants du backend.',
  taggedFiles: 'Fichiers avec des tests marqués @perf : {count}.',
  noTaggedMessage: "Aucun test n'est marqué @perf, tous les tests sont donc proposés.",
  noTaggedHint:
    "Marquez les tests à mesurer avec test('titre', { tag: '@perf' }, ...), puis choisissez @perf.",
  scopeQuestion: 'Mesurer tous les tests ou seulement ceux marqués @perf ? [{all}/@perf]',
  scopeAll: 'tous',

  stepRepeat: 'Répétitions',
  repeatLesson:
    'Chaque règle demande un nombre minimal d’échantillons par endpoint (minSamples), et les échantillons valent appels par test × tests × répétitions.',
  repeatQuestion: 'Répétitions par test dans les mesures ?',

  stepTrial: 'Période d’essai',
  trialLesson:
    'En mode warn-only, les régressions sont signalées sans faire échouer l’exécution : vous pouvez suivre les résultats quelques semaines avant qu’ils ne bloquent les builds.',
  warnOnlyQuestion: 'Commencer en mode warn-only les premières semaines ?',

  stepEnvs: 'Environnements',
  envsLesson:
    'Chaque environnement a ses propres fichiers de seuils (perf-thresholds.<kind>.<label>.json).',
  envsQuestion: 'Testez-vous plusieurs environnements ?',
  envLabelsQuestion: 'Libellés des environnements, séparés par des virgules ?',
  none: 'aucun',

  stepCi: 'CI',
  ciLesson:
    'Un job CI lance la mesure sur les pull requests et chaque nuit, et conserve le rapport.',
  noCi: 'Aucune configuration CI trouvée. Recettes pour GitHub Actions, GitLab CI, Jenkins et Azure Pipelines : {url}',
  ciQuestion: 'Ajouter un job CI pour les mesures ({platform}) ?',

  stepChanges: 'Modifications',
  nothingToChange: 'Rien à modifier : le projet est déjà configuré pour ces réponses.',
  changesLesson: 'Chaque modification est affichée sous forme de diff avant d’être appliquée.',
  newFile: 'nouveau fichier',
  modifiedFile: 'modification',
  overwriteQuestion: '{path} existe déjà. L’écraser ?',
  keptWithYes: '{path} existe déjà et est conservé (--yes ne l’écrase pas).',
  kept: '{path} existe déjà et est conservé.',
  applyQuestion: 'Appliquer cette modification ?',
  fileWritten: 'Écrit : {path}',

  stepFirstRun: 'Première mesure',
  firstRunLesson:
    'Une exécution thresholds mesure les tests et écrit les fichiers de seuils et le rapport ({dir}/).',
  firstRunLaptop:
    'Des seuils mesurés sur un portable ne conviennent pas aux machines CI : calculez ceux que vous committez dans la CI.',
  firstRunQuestion: 'Lancer maintenant une première exécution thresholds ?',
  skipped: 'Ignoré.',

  stepSummary: 'Résumé',
  changedFiles: 'Fichiers modifiés :',
  noFilesChanged: 'Aucun fichier n’a été modifié.',
  plannedChanges: 'Modifications prévues (non écrites) :',
  manualSteps: 'Étapes manuelles : {count} (voir les avertissements ci-dessus).',
  nextSteps: 'Étapes suivantes :',
  nextThresholds:
    '{command} : calculez les seuils et committez les fichiers perf-thresholds.*.json (calculez-les sur les machines CI pour des valeurs stables).',
  nextTest: '{command} : une mesure qui échoue en cas de régression.',
  nextJenkins: 'Créez dans Jenkins un job Pipeline avec le chemin de script {path}.',
  nextAzure: 'Créez un pipeline dans Azure DevOps à partir de {path}.',
  nextWarnOnly: 'Après la période d’essai, retirez gate.warnOnly de pw-perf.config.ts.',
  nextApply:
    'Appliquez les modifications ci-dessus (relancez init dans un terminal ou avec --yes).',
  docs: 'Documentation : {links}',
  finished: 'Configuration terminée.',

  noConfigMessage: 'Aucun playwright.config.* dans {dir}.',
  noConfigHint:
    'Lancez "{command} init" dans le répertoire de playwright.config (dans un monorepo : le paquet qui contient les tests Playwright).',
  tooOldMessage:
    '@playwright/test {version} est antérieur à {min}, la version minimale prise en charge par {pkg}.',
  tooOldHint: 'Mettez à jour @playwright/test en {min} ou plus, puis relancez "{command} init".',
  writeFailedMessage: 'Impossible d’écrire {detail}',
  writeFailedHint: 'Vérifiez les droits du fichier et de son répertoire, puis relancez init.',

  manualPerfConfigKept: "{file} existe déjà et n'a pas été modifié.",
  manualPerfConfigHint: 'Définissez-y ces options si vous les voulez :',
  manualConfigJson: "{config} n'a pas été modifié : la configuration du paquet est {file}.",
  manualConfigPattern:
    "{config} n'a pas été modifié : son export n'est pas un simple defineConfig({...}) ni un objet (par exemple un autre wrapper).",
  configHintIntro:
    'Enveloppez la configuration exportée dans withPerf() comme appel le plus externe (aussi autour des autres wrappers) :',
  configHintCjs: 'Dans {path} avec module.exports : {call}.',
  testHintIntro:
    "Enveloppez chaque objet test utilisé par les tests navigateur dans withPerfFixtures() de '{entry}' :",
  testHintMerge:
    'Enveloppez le résultat de mergeTests() et le test passé à createBdd() (playwright-bdd).',
  testHintImport:
    "Les tests qui importent test depuis @playwright/test peuvent l’importer depuis '{entry}' à la place.",
  manualNoTestObject:
    "Aucun objet test à mesurer : aucun fichier n'importe test depuis @playwright/test.",
  manualTestObjectOne: "{files} n'a pas été modifié :",
  manualTestObjectMany: "{files} n'ont pas été modifiés :",
  testObjectsReason:
    'les objets test ne sont pas un seul `export const test = base.extend(...)` (plusieurs objets test, mergeTests() ou une autre structure).',
  manualNoPackageJson: 'package.json est introuvable.',
  addScripts: 'Ajoutez ces scripts :',
  manualScriptExists: 'package.json : le script "{name}" existe déjà et n’a pas été modifié.',
  manualScriptHint:
    'L’assistant ajouterait "{name}": "{command}". Renommez l’un des deux ou ajoutez la commande à la main.',
  manualPackageJsonInvalid:
    'package.json n\'a pas été modifié : ce n\'est pas un objet JSON avec un objet "scripts".',
  manualCiKept: "{file} existe déjà et n'a pas été modifié.",
  manualCiHint: 'Comparez-le avec examples/ci/ dans le dépôt de {pkg}.',
  manualGitlabInclude: ".gitlab-ci.yml n'a pas été modifié : incluez-y le nouveau fichier de job.",
  manualNpmOne: '{files} installe les dépendances avec npm.',
  manualNpmMany: '{files} installent les dépendances avec npm.',
  manualNpmHint:
    'Ce projet utilise {manager} : remplacez "npm ci" par "{install}" et "npx" par "{npx}".',
};

const it: Messages = {
  declinedInstalled: '{pkg} è installato; nessun file è stato modificato.',
  declinedSteps: 'Per configurarlo a mano:',
  declinedConfig:
    'Avvolgi la configurazione esportata in playwright.config con withPerf() da {config}.',
  declinedTest:
    'Avvolgi il tuo oggetto test con withPerfFixtures() da {fixture}, oppure importa test da {test} invece che da @playwright/test.',
  declinedRun:
    'Esegui {thresholds} e fai commit dei file perf-thresholds.*.json, poi {test} esegue la misurazione.',
  declinedDocs: 'Guida: {url}',
  declinedLater: 'Esegui {init} in qualsiasi momento per la configurazione guidata.',

  noTerminal:
    'nessun terminale: vengono usate le risposte predefinite e non viene scritto nulla (come --dry-run). Usa --yes per scrivere le modifiche.',
  dryRun: 'simulazione: vengono mostrate le modifiche previste e non viene scritto nulla.',
  interrupted: 'interrotto.',
  answerAgain: 'Rispondi di nuovo: quel valore non è valido qui.',
  pressEnter: 'Premi Invio per continuare.',
  yes: 'sì',
  no: 'no',
  yesShort: 's',
  noShort: 'n',

  stepProject: 'Progetto',
  projectLine: '{config} · Playwright {version} · {manager} · {modules}',
  versionUnknown: 'versione sconosciuta',
  testDirLine:
    'Cartella dei test "{dir}" · file che importano @playwright/test: {imports} · file che chiamano .extend(): {extend}',
  projectsPart: 'progetti {names}',
  ciLine: 'CI: {platform}',
  ciNone: 'non trovata',
  alreadySetUp: 'Già configurato: {items}',
  measuredTestObject: 'oggetto test misurato',

  stepHow: 'Come funziona',
  how1: 'Le misurazioni sono esecuzioni separate dai tuoi test abituali: "{test}" esegue i test in modalità perf.',
  how2: 'Ogni test viene eseguito più volte in un solo worker, così ogni richiesta al backend ha abbastanza campioni.',
  how3: 'Le richieste sono raggruppate in chiavi di endpoint come "GET api /users/:id".',
  how4: '"{thresholds}" calcola le soglie per chiave in file che fai commit nel repository.',
  how5: 'Codice di uscita 0: tutto ok, 2: regressione delle prestazioni, 3: errore dello strumento o della configurazione.',

  stepBackend: 'Backend',
  backendLesson: 'Le chiavi di endpoint iniziano con un’etichetta breve dell’origine del backend.',
  noBaseUrl:
    'Nessun baseURL in playwright.config: le richieste vengono etichettate con il loro host.',
  labelQuestion: 'Etichetta per {origin}?',

  stepTests: 'Quali test',
  testsLesson:
    'Una misurazione richiede circa (test × ripetizioni) esecuzioni di test su 1 worker, quindi misura i test che chiamano gli endpoint importanti del backend.',
  taggedFiles: 'File con test contrassegnati @perf: {count}.',
  noTaggedMessage: 'Nessun test ha il tag @perf, quindi vengono proposti tutti i test.',
  noTaggedHint:
    "Contrassegna i test da misurare con test('titolo', { tag: '@perf' }, ...), poi scegli @perf.",
  scopeQuestion: 'Misurare tutti i test o solo quelli contrassegnati @perf? [{all}/@perf]',
  scopeAll: 'tutti',

  stepRepeat: 'Ripetizioni',
  repeatLesson:
    'Ogni regola richiede un numero minimo di campioni per endpoint (minSamples), e i campioni sono chiamate per test × test × ripetizioni.',
  repeatQuestion: 'Ripetizioni per test nelle misurazioni?',

  stepTrial: 'Periodo di prova',
  trialLesson:
    'In modalità warn-only le regressioni vengono segnalate ma non fanno fallire l’esecuzione, così puoi osservare i risultati per qualche settimana prima che blocchino le build.',
  warnOnlyQuestion: 'Iniziare in modalità warn-only per le prime settimane?',

  stepEnvs: 'Ambienti',
  envsLesson: 'Ogni ambiente ha i propri file di soglie (perf-thresholds.<kind>.<label>.json).',
  envsQuestion: 'Esegui i test su più ambienti?',
  envLabelsQuestion: 'Etichette degli ambienti, separate da virgole?',
  none: 'nessuno',

  stepCi: 'CI',
  ciLesson:
    'Un job CI esegue la misurazione sulle pull request e ogni notte, e conserva il report.',
  noCi: 'Nessuna configurazione CI trovata. Ricette per GitHub Actions, GitLab CI, Jenkins e Azure Pipelines: {url}',
  ciQuestion: 'Aggiungere un job CI per le misurazioni ({platform})?',

  stepChanges: 'Modifiche',
  nothingToChange: 'Niente da modificare: il progetto è già configurato per queste risposte.',
  changesLesson: 'Ogni modifica viene mostrata come diff prima di essere applicata.',
  newFile: 'nuovo file',
  modifiedFile: 'modifica',
  overwriteQuestion: '{path} esiste già. Sovrascriverlo?',
  keptWithYes: '{path} esiste già e viene mantenuto (--yes non lo sovrascrive).',
  kept: '{path} esiste già e viene mantenuto.',
  applyQuestion: 'Applicare questa modifica?',
  fileWritten: 'Scritto: {path}',

  stepFirstRun: 'Prima misurazione',
  firstRunLesson:
    'Un’esecuzione thresholds misura i test e scrive i file di soglie e il report ({dir}/).',
  firstRunLaptop:
    'Le soglie misurate su un portatile non vanno bene per le macchine CI: calcola in CI quelle da fare commit.',
  firstRunQuestion: 'Avviare ora una prima esecuzione thresholds?',
  skipped: 'Saltato.',

  stepSummary: 'Riepilogo',
  changedFiles: 'File modificati:',
  noFilesChanged: 'Nessun file è stato modificato.',
  plannedChanges: 'Modifiche previste (non scritte):',
  manualSteps: 'Passi manuali: {count} (vedi gli avvisi sopra).',
  nextSteps: 'Prossimi passi:',
  nextThresholds:
    '{command}: calcola le soglie e fai commit dei file perf-thresholds.*.json (calcolale sulle macchine CI per valori stabili).',
  nextTest: '{command}: una misurazione che fallisce in caso di regressione.',
  nextJenkins: 'Crea in Jenkins un job Pipeline con il percorso dello script {path}.',
  nextAzure: 'Crea una pipeline in Azure DevOps da {path}.',
  nextWarnOnly: 'Dopo il periodo di prova rimuovi gate.warnOnly da pw-perf.config.ts.',
  nextApply: 'Applica le modifiche sopra (esegui di nuovo init in un terminale o con --yes).',
  docs: 'Documentazione: {links}',
  finished: 'Configurazione completata.',

  noConfigMessage: 'Nessun playwright.config.* in {dir}.',
  noConfigHint:
    'Esegui "{command} init" nella cartella di playwright.config (in un monorepo: il pacchetto con i test Playwright).',
  tooOldMessage:
    '@playwright/test {version} è precedente a {min}, la versione minima supportata da {pkg}.',
  tooOldHint:
    'Aggiorna @playwright/test a {min} o successiva, poi esegui di nuovo "{command} init".',
  writeFailedMessage: 'Impossibile scrivere {detail}',
  writeFailedHint: 'Controlla i permessi del file e della sua cartella, poi esegui di nuovo init.',

  manualPerfConfigKept: '{file} esiste già e non è stato modificato.',
  manualPerfConfigHint: 'Imposta lì queste opzioni, se ti servono:',
  manualConfigJson: '{config} non è stato modificato: la configurazione del pacchetto è {file}.',
  manualConfigPattern:
    '{config} non è stato modificato: il suo export non è un semplice defineConfig({...}) né un oggetto (per esempio un altro wrapper).',
  configHintIntro:
    'Avvolgi la configurazione esportata in withPerf() come chiamata più esterna (anche attorno ad altri wrapper):',
  configHintCjs: 'In {path} con module.exports: {call}.',
  testHintIntro:
    "Avvolgi ogni oggetto test usato dai test del browser in withPerfFixtures() da '{entry}':",
  testHintMerge:
    'Avvolgi il risultato di mergeTests() e il test passato a createBdd() (playwright-bdd).',
  testHintImport:
    "I test che importano test da @playwright/test possono importarlo invece da '{entry}'.",
  manualNoTestObject:
    'Nessun oggetto test da misurare: nessun file importa test da @playwright/test.',
  manualTestObjectOne: '{files} non è stato modificato:',
  manualTestObjectMany: '{files} non sono stati modificati:',
  testObjectsReason:
    'gli oggetti test non sono un unico `export const test = base.extend(...)` (più oggetti test, mergeTests() o un’altra struttura).',
  manualNoPackageJson: 'package.json non trovato.',
  addScripts: 'Aggiungi questi script:',
  manualScriptExists: 'package.json: lo script "{name}" esiste già e non è stato modificato.',
  manualScriptHint:
    'La procedura guidata aggiungerebbe "{name}": "{command}". Rinomina uno dei due o aggiungi il comando a mano.',
  manualPackageJsonInvalid:
    'package.json non è stato modificato: non è un oggetto JSON con un oggetto "scripts".',
  manualCiKept: '{file} esiste già e non è stato modificato.',
  manualCiHint: 'Confrontalo con examples/ci/ nel repository di {pkg}.',
  manualGitlabInclude: '.gitlab-ci.yml non è stato modificato: includi il nuovo file del job.',
  manualNpmOne: '{files} installa le dipendenze con npm.',
  manualNpmMany: '{files} installano le dipendenze con npm.',
  manualNpmHint:
    'Questo progetto usa {manager}: sostituisci "npm ci" con "{install}" e "npx" con "{npx}".',
};

const uk: Messages = {
  declinedInstalled: '{pkg} встановлено; жоден файл не змінено.',
  declinedSteps: 'Щоб налаштувати вручну:',
  declinedConfig:
    'Обгорніть експортовану конфігурацію в playwright.config у withPerf() з {config}.',
  declinedTest:
    'Обгорніть свій об’єкт test у withPerfFixtures() з {fixture} або імпортуйте test з {test} замість @playwright/test.',
  declinedRun:
    'Запустіть {thresholds} і закомітьте файли perf-thresholds.*.json, після цього {test} виконує вимірювання.',
  declinedDocs: 'Посібник: {url}',
  declinedLater: 'Запустіть {init} будь-коли для налаштування з підказками.',

  noTerminal:
    'немає термінала: використовуються типові відповіді, нічого не записується (як --dry-run). Додайте --yes, щоб записати зміни.',
  dryRun: 'пробний запуск: показано заплановані зміни, нічого не записується.',
  interrupted: 'перервано.',
  answerAgain: 'Відповідайте ще раз: це значення тут не підходить.',
  pressEnter: 'Натисніть Enter, щоб продовжити.',
  yes: 'так',
  no: 'ні',
  yesShort: 'т',
  noShort: 'н',

  stepProject: 'Проєкт',
  projectLine: '{config} · Playwright {version} · {manager} · {modules}',
  versionUnknown: 'версія невідома',
  testDirLine:
    'Каталог тестів "{dir}" · файли, що імпортують @playwright/test: {imports} · файли, що викликають .extend(): {extend}',
  projectsPart: 'проєкти {names}',
  ciLine: 'CI: {platform}',
  ciNone: 'не знайдено',
  alreadySetUp: 'Уже налаштовано: {items}',
  measuredTestObject: 'вимірюваний об’єкт test',

  stepHow: 'Як це працює',
  how1: 'Вимірювання — це окремі запуски, не ваші звичайні тести: "{test}" запускає тести в режимі perf.',
  how2: 'Кожен тест виконується кілька разів в одному worker, тож кожен запит до бекенду має достатньо вимірів.',
  how3: 'Запити групуються в ключі ендпоінтів, наприклад "GET api /users/:id".',
  how4: '"{thresholds}" обчислює пороги для кожного ключа у файли, які ви комітите в репозиторій.',
  how5: 'Код виходу 0 — усе гаразд, 2 — регресія продуктивності, 3 — помилка інструмента або конфігурації.',

  stepBackend: 'Бекенд',
  backendLesson: 'Ключі ендпоінтів починаються з короткої мітки origin бекенду.',
  noBaseUrl: 'У playwright.config немає baseURL: запити позначаються своїм хостом.',
  labelQuestion: 'Мітка для {origin}?',

  stepTests: 'Які тести',
  testsLesson:
    'Вимірювання триває приблизно (тести × повторення) запусків тестів на 1 worker, тож вимірюйте тести, що викликають важливі ендпоінти бекенду.',
  taggedFiles: 'Файли з тестами з тегом @perf: {count}.',
  noTaggedMessage: 'Жоден тест не має тегу @perf, тому пропонуються всі тести.',
  noTaggedHint:
    "Позначте тести для вимірювання: test('назва', { tag: '@perf' }, ...), а потім виберіть @perf.",
  scopeQuestion: 'Вимірювати всі тести чи лише з тегом @perf? [{all}/@perf]',
  scopeAll: 'усі',

  stepRepeat: 'Повторення',
  repeatLesson:
    'Кожне правило потребує мінімальної кількості вимірів на ендпоінт (minSamples), а вимірів буде: виклики в тесті × тести × повторення.',
  repeatQuestion: 'Скільки повторень кожного тесту під час вимірювання?',

  stepTrial: 'Пробний період',
  trialLesson:
    'У режимі warn-only регресії показуються, але запуск не завершується помилкою, тож кілька тижнів можна спостерігати за результатами, перш ніж вони почнуть блокувати збірки.',
  warnOnlyQuestion: 'Почати в режимі warn-only на перші тижні?',

  stepEnvs: 'Середовища',
  envsLesson: 'Кожне середовище має власні файли порогів (perf-thresholds.<kind>.<label>.json).',
  envsQuestion: 'Ви тестуєте кілька середовищ?',
  envLabelsQuestion: 'Мітки середовищ через кому?',
  none: 'немає',

  stepCi: 'CI',
  ciLesson: 'Job у CI запускає вимірювання для pull request і щоночі та зберігає звіт.',
  noCi: 'Конфігурацію CI не знайдено. Рецепти для GitHub Actions, GitLab CI, Jenkins та Azure Pipelines: {url}',
  ciQuestion: 'Додати job у CI для вимірювань ({platform})?',

  stepChanges: 'Зміни',
  nothingToChange: 'Нічого змінювати: проєкт уже налаштовано для цих відповідей.',
  changesLesson: 'Кожну зміну показано як diff, перш ніж її застосувати.',
  newFile: 'новий файл',
  modifiedFile: 'зміна',
  overwriteQuestion: '{path} уже існує. Перезаписати?',
  keptWithYes: '{path} уже існує і залишається без змін (--yes його не перезаписує).',
  kept: '{path} уже існує і залишається без змін.',
  applyQuestion: 'Застосувати цю зміну?',
  fileWritten: 'Записано: {path}',

  stepFirstRun: 'Перше вимірювання',
  firstRunLesson: 'Запуск thresholds вимірює тести та записує файли порогів і звіт ({dir}/).',
  firstRunLaptop:
    'Пороги, виміряні на ноутбуці, не підходять для машин CI: ті, що комітите, обчислюйте в CI.',
  firstRunQuestion: 'Запустити зараз перший запуск thresholds?',
  skipped: 'Пропущено.',

  stepSummary: 'Підсумок',
  changedFiles: 'Змінені файли:',
  noFilesChanged: 'Жоден файл не змінено.',
  plannedChanges: 'Заплановані зміни (не записані):',
  manualSteps: 'Ручні кроки: {count} (див. попередження вище).',
  nextSteps: 'Наступні кроки:',
  nextThresholds:
    '{command}: обчисліть пороги й закомітьте файли perf-thresholds.*.json (для стабільних значень обчислюйте їх на машинах CI).',
  nextTest: '{command}: вимірювання, яке завершується помилкою при регресії.',
  nextJenkins: 'Створіть у Jenkins job типу Pipeline зі шляхом до скрипта {path}.',
  nextAzure: 'Створіть pipeline в Azure DevOps з {path}.',
  nextWarnOnly: 'Після пробного періоду видаліть gate.warnOnly з pw-perf.config.ts.',
  nextApply: 'Застосуйте зміни вище (запустіть init ще раз у терміналі або з --yes).',
  docs: 'Документація: {links}',
  finished: 'Налаштування завершено.',

  noConfigMessage: 'У {dir} немає playwright.config.*.',
  noConfigHint:
    'Запустіть "{command} init" у каталозі з playwright.config (у монорепозиторії: у пакеті з тестами Playwright).',
  tooOldMessage:
    '@playwright/test {version} старіший за {min}, найнижчу версію, яку підтримує {pkg}.',
  tooOldHint:
    'Оновіть @playwright/test до {min} або новішої, потім знову запустіть "{command} init".',
  writeFailedMessage: 'Не вдалося записати {detail}',
  writeFailedHint: 'Перевірте права доступу до файлу та його каталогу, потім знову запустіть init.',

  manualPerfConfigKept: '{file} уже існує і не змінювався.',
  manualPerfConfigHint: 'Задайте в ньому ці параметри, якщо вони потрібні:',
  manualConfigJson: '{config} не змінено: конфігурація пакета — {file}.',
  manualConfigPattern:
    '{config} не змінено: його export — не простий defineConfig({...}) і не об’єкт (наприклад, інша обгортка).',
  configHintIntro:
    'Обгорніть експортовану конфігурацію у withPerf() як найзовнішній виклик (також навколо інших обгорток):',
  configHintCjs: 'У {path} з module.exports: {call}.',
  testHintIntro:
    "Обгорніть кожен об’єкт test, який використовують браузерні тести, у withPerfFixtures() з '{entry}':",
  testHintMerge:
    'Обгорніть результат mergeTests() і test, що передається в createBdd() (playwright-bdd).',
  testHintImport:
    "Тести, які імпортують test з @playwright/test, можуть натомість імпортувати його з '{entry}'.",
  manualNoTestObject:
    'Не знайдено об’єкта test для вимірювання: жоден файл не імпортує test з @playwright/test.',
  manualTestObjectOne: '{files} не змінено:',
  manualTestObjectMany: '{files} не змінено:',
  testObjectsReason:
    'об’єкти test — це не один `export const test = base.extend(...)` (кілька об’єктів test, mergeTests() або інша структура).',
  manualNoPackageJson: 'package.json не знайдено.',
  addScripts: 'Додайте ці скрипти:',
  manualScriptExists: 'package.json: скрипт "{name}" уже існує і не змінювався.',
  manualScriptHint:
    'Майстер додав би "{name}": "{command}". Перейменуйте один із них або додайте команду вручну.',
  manualPackageJsonInvalid: 'package.json не змінено: це не JSON-об’єкт з об’єктом "scripts".',
  manualCiKept: '{file} уже існує і не змінювався.',
  manualCiHint: 'Порівняйте його з examples/ci/ у репозиторії {pkg}.',
  manualGitlabInclude: '.gitlab-ci.yml не змінено: підключіть у ньому новий файл job.',
  manualNpmOne: '{files} встановлює залежності через npm.',
  manualNpmMany: '{files} встановлюють залежності через npm.',
  manualNpmHint:
    'Цей проєкт використовує {manager}: замініть "npm ci" на "{install}", а "npx" на "{npx}".',
};

const ru: Messages = {
  declinedInstalled: '{pkg} установлен; ни один файл не изменён.',
  declinedSteps: 'Чтобы настроить вручную:',
  declinedConfig:
    'Оберните экспортируемую конфигурацию в playwright.config в withPerf() из {config}.',
  declinedTest:
    'Оберните свой объект test в withPerfFixtures() из {fixture} или импортируйте test из {test} вместо @playwright/test.',
  declinedRun:
    'Запустите {thresholds} и закоммитьте файлы perf-thresholds.*.json, после этого {test} выполняет измерение.',
  declinedDocs: 'Руководство: {url}',
  declinedLater: 'Запустите {init} в любой момент для настройки с подсказками.',

  noTerminal:
    'нет терминала: используются ответы по умолчанию, ничего не записывается (как --dry-run). Добавьте --yes, чтобы записать изменения.',
  dryRun: 'пробный запуск: показаны запланированные изменения, ничего не записывается.',
  interrupted: 'прервано.',
  answerAgain: 'Ответьте ещё раз: это значение здесь не подходит.',
  pressEnter: 'Нажмите Enter, чтобы продолжить.',
  yes: 'да',
  no: 'нет',
  yesShort: 'д',
  noShort: 'н',

  stepProject: 'Проект',
  projectLine: '{config} · Playwright {version} · {manager} · {modules}',
  versionUnknown: 'версия неизвестна',
  testDirLine:
    'Каталог тестов "{dir}" · файлы, импортирующие @playwright/test: {imports} · файлы, вызывающие .extend(): {extend}',
  projectsPart: 'проекты {names}',
  ciLine: 'CI: {platform}',
  ciNone: 'не найдено',
  alreadySetUp: 'Уже настроено: {items}',
  measuredTestObject: 'измеряемый объект test',

  stepHow: 'Как это работает',
  how1: 'Измерения — это отдельные запуски, а не ваши обычные тесты: "{test}" запускает тесты в режиме perf.',
  how2: 'Каждый тест выполняется несколько раз в одном worker, поэтому у каждого запроса к бэкенду достаточно замеров.',
  how3: 'Запросы группируются в ключи эндпоинтов, например "GET api /users/:id".',
  how4: '"{thresholds}" вычисляет пороги по каждому ключу в файлы, которые вы коммитите в репозиторий.',
  how5: 'Код выхода 0 — всё в порядке, 2 — регрессия производительности, 3 — ошибка инструмента или конфигурации.',

  stepBackend: 'Бэкенд',
  backendLesson: 'Ключи эндпоинтов начинаются с короткой метки origin бэкенда.',
  noBaseUrl: 'В playwright.config нет baseURL: запросы помечаются своим хостом.',
  labelQuestion: 'Метка для {origin}?',

  stepTests: 'Какие тесты',
  testsLesson:
    'Измерение занимает примерно (тесты × повторения) запусков тестов на 1 worker, поэтому измеряйте тесты, которые вызывают важные эндпоинты бэкенда.',
  taggedFiles: 'Файлы с тестами с тегом @perf: {count}.',
  noTaggedMessage: 'Ни у одного теста нет тега @perf, поэтому предлагаются все тесты.',
  noTaggedHint:
    "Отметьте тесты для измерения: test('название', { tag: '@perf' }, ...), затем выберите @perf.",
  scopeQuestion: 'Измерять все тесты или только с тегом @perf? [{all}/@perf]',
  scopeAll: 'все',

  stepRepeat: 'Повторения',
  repeatLesson:
    'Каждому правилу нужно минимальное число замеров на эндпоинт (minSamples), а замеров будет: вызовы в тесте × тесты × повторения.',
  repeatQuestion: 'Сколько повторений каждого теста при измерении?',

  stepTrial: 'Пробный период',
  trialLesson:
    'В режиме warn-only регрессии показываются, но запуск не завершается ошибкой, так что несколько недель можно наблюдать за результатами, прежде чем они начнут блокировать сборки.',
  warnOnlyQuestion: 'Начать в режиме warn-only на первые недели?',

  stepEnvs: 'Окружения',
  envsLesson: 'У каждого окружения свои файлы порогов (perf-thresholds.<kind>.<label>.json).',
  envsQuestion: 'Вы тестируете несколько окружений?',
  envLabelsQuestion: 'Метки окружений через запятую?',
  none: 'нет',

  stepCi: 'CI',
  ciLesson: 'Job в CI запускает измерение для pull request и каждую ночь и сохраняет отчёт.',
  noCi: 'Конфигурация CI не найдена. Рецепты для GitHub Actions, GitLab CI, Jenkins и Azure Pipelines: {url}',
  ciQuestion: 'Добавить job в CI для измерений ({platform})?',

  stepChanges: 'Изменения',
  nothingToChange: 'Менять нечего: проект уже настроен для этих ответов.',
  changesLesson: 'Каждое изменение показывается как diff, прежде чем его применить.',
  newFile: 'новый файл',
  modifiedFile: 'изменение',
  overwriteQuestion: '{path} уже существует. Перезаписать?',
  keptWithYes: '{path} уже существует и остаётся без изменений (--yes его не перезаписывает).',
  kept: '{path} уже существует и остаётся без изменений.',
  applyQuestion: 'Применить это изменение?',
  fileWritten: 'Записано: {path}',

  stepFirstRun: 'Первое измерение',
  firstRunLesson: 'Запуск thresholds измеряет тесты и записывает файлы порогов и отчёт ({dir}/).',
  firstRunLaptop:
    'Пороги, измеренные на ноутбуке, не подходят для машин CI: те, что вы коммитите, вычисляйте в CI.',
  firstRunQuestion: 'Выполнить сейчас первый запуск thresholds?',
  skipped: 'Пропущено.',

  stepSummary: 'Итог',
  changedFiles: 'Изменённые файлы:',
  noFilesChanged: 'Ни один файл не изменён.',
  plannedChanges: 'Запланированные изменения (не записаны):',
  manualSteps: 'Ручные шаги: {count} (см. предупреждения выше).',
  nextSteps: 'Дальнейшие шаги:',
  nextThresholds:
    '{command}: вычислите пороги и закоммитьте файлы perf-thresholds.*.json (для стабильных значений вычисляйте их на машинах CI).',
  nextTest: '{command}: измерение, которое завершается ошибкой при регрессии.',
  nextJenkins: 'Создайте в Jenkins job типа Pipeline с путём к скрипту {path}.',
  nextAzure: 'Создайте pipeline в Azure DevOps из {path}.',
  nextWarnOnly: 'После пробного периода удалите gate.warnOnly из pw-perf.config.ts.',
  nextApply: 'Примените изменения выше (запустите init ещё раз в терминале или с --yes).',
  docs: 'Документация: {links}',
  finished: 'Настройка завершена.',

  noConfigMessage: 'В {dir} нет playwright.config.*.',
  noConfigHint:
    'Запустите "{command} init" в каталоге с playwright.config (в монорепозитории: в пакете с тестами Playwright).',
  tooOldMessage:
    '@playwright/test {version} старше {min}, минимальной версии, которую поддерживает {pkg}.',
  tooOldHint:
    'Обновите @playwright/test до {min} или новее, затем снова запустите "{command} init".',
  writeFailedMessage: 'Не удалось записать {detail}',
  writeFailedHint: 'Проверьте права доступа к файлу и его каталогу, затем снова запустите init.',

  manualPerfConfigKept: '{file} уже существует и не изменялся.',
  manualPerfConfigHint: 'Задайте в нём эти параметры, если они нужны:',
  manualConfigJson: '{config} не изменён: конфигурация пакета — {file}.',
  manualConfigPattern:
    '{config} не изменён: его export — не простой defineConfig({...}) и не объект (например, другая обёртка).',
  configHintIntro:
    'Оберните экспортируемую конфигурацию в withPerf() как самый внешний вызов (в том числе вокруг других обёрток):',
  configHintCjs: 'В {path} с module.exports: {call}.',
  testHintIntro:
    "Оберните каждый объект test, который используют браузерные тесты, в withPerfFixtures() из '{entry}':",
  testHintMerge:
    'Оберните результат mergeTests() и test, передаваемый в createBdd() (playwright-bdd).',
  testHintImport:
    "Тесты, которые импортируют test из @playwright/test, могут вместо этого импортировать его из '{entry}'.",
  manualNoTestObject:
    'Не найден объект test для измерения: ни один файл не импортирует test из @playwright/test.',
  manualTestObjectOne: '{files} не изменён:',
  manualTestObjectMany: '{files} не изменены:',
  testObjectsReason:
    'объекты test — это не один `export const test = base.extend(...)` (несколько объектов test, mergeTests() или другая структура).',
  manualNoPackageJson: 'package.json не найден.',
  addScripts: 'Добавьте эти скрипты:',
  manualScriptExists: 'package.json: скрипт "{name}" уже существует и не изменялся.',
  manualScriptHint:
    'Мастер добавил бы "{name}": "{command}". Переименуйте один из них или добавьте команду вручную.',
  manualPackageJsonInvalid: 'package.json не изменён: это не JSON-объект с объектом "scripts".',
  manualCiKept: '{file} уже существует и не изменялся.',
  manualCiHint: 'Сравните его с examples/ci/ в репозитории {pkg}.',
  manualGitlabInclude: '.gitlab-ci.yml не изменён: подключите в нём новый файл job.',
  manualNpmOne: '{files} устанавливает зависимости через npm.',
  manualNpmMany: '{files} устанавливают зависимости через npm.',
  manualNpmHint:
    'Этот проект использует {manager}: замените "npm ci" на "{install}", а "npx" на "{npx}".',
};

export const MESSAGES: Record<WizardLanguage, Messages> = { en, es, fr, pl, it, uk, ru };

const PLACEHOLDER = /\{(\w+)\}/gu;

/** The {name} placeholders of a text, sorted and without duplicates. */
export function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1] as string))].sort();
}

export type MessageValues = Readonly<Record<string, string | number>>;

/** Fills the {name} placeholders; other braces (such as `{...}` in code) stay. */
export function format(text: string, values: MessageValues = {}): string {
  return text.replace(PLACEHOLDER, (whole, name: string) =>
    values[name] === undefined ? whole : String(values[name]),
  );
}

/** Text of `key` in one language. */
export type Translate = (key: MessageKey, values?: MessageValues) => string;

export function translator(lang: WizardLanguage): Translate {
  return (key, values) => format(MESSAGES[lang][key], values);
}
