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
  declinedDocs: 'Guide: {url}',
  declinedLater: 'Run {init} any time for the guided setup.',
  noTerminal:
    'no terminal: the default answers are used and nothing is written Run the setup again in a terminal to write the changes.',
  dryRun: 'dry run: the planned changes are shown and nothing is written.',
  interrupted: 'interrupted.',
  answerAgain: 'Please answer again: that value is not valid here.',
  pressEnter: 'Press Enter to continue.',
  yes: 'yes',
  no: 'no',
  yesShort: 'y',
  noShort: 'n',
  projectLine: '{config} · Playwright {version} · {manager} · {modules}',
  versionUnknown: 'version unknown',
  testDirLine:
    'Test directory "{dir}" · files importing @playwright/test: {imports} · files calling .extend(): {extend}',
  projectsPart: 'projects {names}',
  ciLine: 'CI: {platform}',
  ciNone: 'none found',
  alreadySetUp: 'Already set up: {items}',
  measuredTestObject: 'measured test object',
  stepTests: 'Which tests',
  testsLesson:
    'A measurement run takes about (tests × passes) test runs on 1 worker, so measure the tests that call the important backend endpoints.',
  taggedFiles: 'Files with tests tagged @perf: {count}.',
  noTaggedMessage: 'No test is tagged @perf yet; all tests are measured.',
  noTaggedHint:
    "To measure only some tests, tag them with test('title', { tag: '@perf' }, ...) and choose @perf.",
  scopeQuestion: 'Measure all tests or only tests tagged @perf? [{all}/@perf]',
  scopeAll: 'all',
  stepPasses: 'Passes',
  passesLesson:
    'Each rule needs a minimum number of samples per endpoint (minSamples), and samples are calls per test × tests × passes. Your test command, with its setup steps, runs once per pass.',
  passesQuestion: 'Passes of the test command in measurement runs?',
  stepSteps: 'Test steps',
  stepsLesson:
    'Durations of your test.step blocks can be measured too, without changing the tests: each step becomes a key such as "checkout › pay".',
  stepsPrivacy:
    'Step titles are sanitized: ids, e-mails, URLs and secrets never reach the keys, also inside quotes.',
  stepsQuestion: 'Also measure the duration of your test.step blocks (found in {count} files)?',
  stepCi: 'CI',
  noCi: 'No CI configuration found. Recipes for GitHub Actions, GitLab CI, Jenkins and Azure Pipelines: {url}',
  stepChanges: 'Changes',
  nothingToChange: 'Nothing to change: the project is already set up for these answers.',
  changesLesson: 'Each change is shown as a diff before it is applied.',
  newFile: 'new file',
  modifiedFile: 'change',
  overwriteQuestion: '{path} exists. Overwrite it?',
  kept: '{path} exists and is kept.',
  applyQuestion: 'Apply this change?',
  fileWritten: 'Written: {path}',
  skipped: 'Skipped.',
  stepSummary: 'Summary',
  changedFiles: 'Changed files:',
  noFilesChanged: 'No files were changed.',
  plannedChanges: 'Planned changes (not written):',
  manualSteps: 'Manual steps: {count} (see the warnings above).',
  nextSteps: 'Next steps:',
  nextJenkins: 'Create a Pipeline job in Jenkins with the script path {path}.',
  nextAzure: 'Create a pipeline in Azure DevOps from {path}.',
  nextApply: 'Apply the changes above (run the setup again in a terminal).',
  originsNote:
    'Endpoint keys of the baseURL origin have no label and other hosts are labeled with their host; set shorter labels for them in keys.origins of pw-perf.config.ts.',
  docs: 'Docs: {links}',
  finished: 'Setup finished.',
  noConfigMessage: 'No playwright.config.* in {dir}.',
  noConfigHint:
    'Run "{command}" in the directory of playwright.config (in a monorepo: the package with the Playwright tests).',
  tooOldMessage:
    '@playwright/test {version} is older than {min}, the lowest version {pkg} supports.',
  tooOldHint: 'Update @playwright/test to {min} or later, then run "{command}" again.',
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
  manualCiKept: '{file} exists and was not changed.',
  manualCiHint: 'Compare it with examples/ci/ in the {pkg} repository.',
  manualGitlabInclude: '.gitlab-ci.yml was not changed: include the new job file in it.',
  manualNpmOne: '{files} installs the dependencies with npm.',
  manualNpmHint:
    'This project uses {manager}: replace "npm ci" with "{install}" and "npx" with "{npx}".',

  declinedRun:
    'Run your test command with PW_PERF_MODE=thresholds and commit the pw-perf-thresholds*.json files, then PW_PERF_MODE=test runs the measurement (e.g. {example}).',
  stepProject: 'Package and project',
  about1:
    '{pkg} measures the response times of backend endpoints (and optionally your test.step blocks) in the e2e tests you already have, without changing them.',
  about2:
    'A measurement run is your usual test command with PW_PERF_MODE set, run several times on 1 worker.',
  about3: 'It derives thresholds itself and writes them to files you commit to the repository.',
  about4: 'A run fails on a performance regression and leaves an HTML report.',
  stepScript: 'Test command',
  scriptLesson:
    'A measurement uses your own test command, so its setup steps, variables and flags work as they are. Scripts that run playwright test:',
  scriptPlain: 'plain playwright test',
  scriptQuestion: 'Which command runs the tests you want to measure? [1-{count}]',
  scriptSelectsTests:
    'This script selects its tests itself (--grep or file paths), so the question about @perf is skipped.',
  scriptFlagMessage: 'The script "{name}" has flags that break a measurement run: {flags}.',
  scriptFlagHint:
    'Add a script without them (e.g. "{name}:perf") and choose it when you run init again. The script was not changed.',
  flagInteractive: 'interactive run, nothing useful is measured',
  flagSharded: 'sharded run (RUN_SHARDED, exit code 3)',
  flagReporter: 'replaces the package reporter: no report and no outcome.json',
  flagChangingTests: 'the tests change between runs, so keys and thresholds drift',
  flagConditions: 'overrides the run conditions of perf mode',
  laterStepsMessage:
    'The script "{name}" runs more steps after Playwright, also in measurement runs: {steps}.',
  laterStepsHint:
    'If they should not run then, add a script without them; the wizard does not create it.',
  oldScripts: 'The perf:* scripts of an earlier wizard ({names}) no longer work; remove them.',
  stepProjects: 'Projects',
  projectsLesson:
    'Measured projects run in every pass; setup and teardown projects run once per pass, as usual. Tests that only use the request fixture measure nothing.',
  projectHelper: 'setup/teardown, runs as a dependency',
  projectApi: 'looks like API tests: requests outside the browser are not measured',
  projectsQuestion: 'Which projects should be measured? (numbers separated by commas)',
  projectsNeedScript: 'The script runs --project {names}: keep these projects selected.',
  taggedSaved: '@perf is saved as run.grep in pw-perf.config.ts; your commands stay the same.',
  stepPreset: 'Threshold headroom',
  presetLesson:
    'Thresholds are the times of a thresholds run plus headroom. The preset sets the headroom of every rule:',
  presetStrict:
    'strict: small headroom; catches smaller regressions, more false alarms on a noisy environment.',
  presetNormal: 'normal: recommended to start with.',
  presetLoose: 'loose: large headroom; only clear regressions, for shared or noisy environments.',
  presetQuestion: 'How much headroom should derived thresholds have? [strict/normal/loose]',
  ci1: 'Derive thresholds on the CI machines that will measure: times from a laptop do not carry over.',
  ci2: 'A CI job you start by hand with PW_PERF_MODE=thresholds saves the thresholds files as an artifact.',
  ci3: 'Download them and commit them to the repository.',
  ci4: 'A scheduled job (once a week by default) with PW_PERF_MODE=test fails on a regression.',
  ciQuestion: 'Add the CI jobs for thresholds and measurement runs ({platform})?',
  stepCheck: 'Check',
  checkLesson:
    'The check runs a few tests once and shows what will be measured and how long a full run takes. Nothing is evaluated or written.',
  checkQuestion: 'Run a check now?',
  checkManual: 'Run it yourself: {command}',
  checkExit: 'The check ended with exit code {code}.',
  boxTitle: 'Action needed: nothing is measured yet',
  boxWhy:
    'Without the perf fixture the package measures no request. The wizard does not change your test files; add one of these by hand:',
  boxFixtures: 'If you have a fixtures file that exports test:',
  boxFixturesFiles: 'Files with .extend(): {files}',
  boxImports:
    'If your tests import test from @playwright/test ({count} files), change the import in each of them:',
  boxDocs: 'Other layouts (mergeTests, several test objects, playwright-bdd): {url}',
  runLine: 'Run: {command}',
  runLesson: 'A measurement is your usual test command with PW_PERF_MODE set.',
  nextCheck: '{command}: see what will be measured and how long a full run takes.',
  nextThresholds:
    '{command}: derive thresholds first, on the CI machines that will measure: run the manual thresholds CI job (or this command there) and download the thresholds files from its artifact. Until they exist, measurement runs use the loose default thresholds. {estimate}',
  nextThresholdsNoCi:
    '{command}: derive thresholds first, on the CI machines that will measure (see {url}). Until the thresholds files exist, measurement runs use the loose default thresholds. {estimate}',
  estimateUnknown: '(Run the check command for an estimate.)',
  estimateAbove: '(The check above shows an estimate.)',
  nextCommit: 'Commit {files}.',
  nextTest:
    '{command}: a measurement run that fails on a regression. Results: {report}; exit code details: {outcome}.',
  nextCiJobs: 'The measurement job in {path} runs once a week and can be started by hand.',
  windowsNote: 'PowerShell and cmd forms of these commands: docs/cli.md.',
};

export type MessageKey = keyof typeof en;
type Messages = Record<MessageKey, string>;

const pl: Messages = {
  declinedInstalled: '{pkg} jest zainstalowana; żaden plik nie został zmieniony.',
  declinedSteps: 'Konfiguracja ręczna:',
  declinedConfig: 'Owiń eksportowaną konfigurację w playwright.config w withPerf() z {config}.',
  declinedTest:
    'Owiń swój obiekt test w withPerfFixtures() z {fixture} albo importuj test z {test} zamiast z @playwright/test.',
  declinedDocs: 'Przewodnik: {url}',
  declinedLater: 'Konfigurację z przewodnikiem uruchomisz w każdej chwili poleceniem {init}.',
  noTerminal:
    'brak terminala: kreator przyjmuje odpowiedzi domyślne i niczego nie zapisuje Uruchom konfigurację ponownie w terminalu, aby zapisać zmiany.',
  dryRun: 'próba: kreator pokazuje planowane zmiany i niczego nie zapisuje.',
  interrupted: 'przerwano.',
  answerAgain: 'Odpowiedz jeszcze raz: ta wartość nie jest tu poprawna.',
  pressEnter: 'Naciśnij Enter, aby kontynuować.',
  yes: 'tak',
  no: 'nie',
  yesShort: 't',
  noShort: 'n',
  projectLine: '{config} · Playwright {version} · {manager} · {modules}',
  versionUnknown: 'wersja nieznana',
  testDirLine:
    'Katalog testów "{dir}" · pliki z importem @playwright/test: {imports} · pliki z wywołaniem .extend(): {extend}',
  projectsPart: 'projekty {names}',
  ciLine: 'CI: {platform}',
  ciNone: 'nie znaleziono',
  alreadySetUp: 'Już skonfigurowane: {items}',
  measuredTestObject: 'mierzony obiekt test',
  stepTests: 'Które testy',
  testsLesson:
    'Pomiar trwa mniej więcej tyle, co (testy × przebiegi) uruchomień testów na 1 workerze, więc mierz testy, które wywołują ważne endpointy backendu.',
  taggedFiles: 'Pliki z testami oznaczonymi @perf: {count}.',
  noTaggedMessage: 'Żaden test nie ma jeszcze tagu @perf; mierzone są wszystkie testy.',
  noTaggedHint:
    "Aby mierzyć tylko część testów, oznacz je: test('tytuł', { tag: '@perf' }, ...) i wybierz @perf.",
  scopeQuestion: 'Mierzyć wszystkie testy czy tylko oznaczone @perf? [{all}/@perf]',
  scopeAll: 'wszystkie',
  stepPasses: 'Przebiegi',
  passesLesson:
    'Każda reguła potrzebuje minimalnej liczby próbek na endpoint (minSamples), a próbek jest: wywołania w teście × testy × przebiegi. Polecenie testów, z krokami przygotowania, wykonuje się raz na przebieg.',
  passesQuestion: 'Ile przebiegów polecenia testów w pomiarze?',
  stepSteps: 'Kroki testu',
  stepsLesson:
    'Czasy bloków test.step też mogą być mierzone, bez zmian w testach: każdy krok staje się kluczem, np. "checkout › pay".',
  stepsPrivacy:
    'Tytuły kroków są sanityzowane: identyfikatory, e-maile, adresy URL i sekrety nie trafiają do kluczy, także w cudzysłowach.',
  stepsQuestion: 'Mierzyć też czasy bloków test.step (znalezione w {count} plikach)?',
  stepCi: 'CI',
  noCi: 'Nie znaleziono konfiguracji CI. Przepisy dla GitHub Actions, GitLab CI, Jenkinsa i Azure Pipelines: {url}',
  stepChanges: 'Zmiany',
  nothingToChange: 'Nic do zmiany: projekt jest już skonfigurowany dla tych odpowiedzi.',
  changesLesson: 'Każda zmiana jest najpierw pokazana jako diff, a dopiero potem zastosowana.',
  newFile: 'nowy plik',
  modifiedFile: 'zmiana',
  overwriteQuestion: '{path} już istnieje. Nadpisać go?',
  kept: '{path} już istnieje i zostaje bez zmian.',
  applyQuestion: 'Zastosować tę zmianę?',
  fileWritten: 'Zapisano: {path}',
  skipped: 'Pominięto.',
  stepSummary: 'Podsumowanie',
  changedFiles: 'Zmienione pliki:',
  noFilesChanged: 'Żaden plik nie został zmieniony.',
  plannedChanges: 'Planowane zmiany (niezapisane):',
  manualSteps: 'Kroki ręczne: {count} (zobacz ostrzeżenia powyżej).',
  nextSteps: 'Następne kroki:',
  nextJenkins: 'Utwórz w Jenkinsie job typu Pipeline ze ścieżką skryptu {path}.',
  nextAzure: 'Utwórz w Azure DevOps pipeline z pliku {path}.',
  nextApply: 'Zastosuj powyższe zmiany (uruchom konfigurację ponownie w terminalu).',
  originsNote:
    'Klucze endpointów originu z baseURL nie mają etykiety, a inne hosty są oznaczone nazwą hosta; krótsze etykiety dla nich ustawisz w keys.origins w pw-perf.config.ts.',
  docs: 'Dokumentacja: {links}',
  finished: 'Konfiguracja zakończona.',
  noConfigMessage: 'Brak playwright.config.* w {dir}.',
  noConfigHint:
    'Uruchom "{command}" w katalogu z playwright.config (w monorepo: w pakiecie z testami Playwrighta).',
  tooOldMessage:
    '@playwright/test {version} jest starszy niż {min}, najniższa wersja obsługiwana przez {pkg}.',
  tooOldHint:
    'Zaktualizuj @playwright/test do {min} lub nowszej, potem uruchom ponownie "{command}".',
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
  manualCiKept: '{file} już istnieje i nie został zmieniony.',
  manualCiHint: 'Porównaj go z examples/ci/ w repozytorium {pkg}.',
  manualGitlabInclude: 'Nie zmieniono .gitlab-ci.yml: dołącz do niego nowy plik joba.',
  manualNpmOne: '{files} instaluje zależności przez npm.',
  manualNpmHint: 'Ten projekt używa {manager}: zamień "npm ci" na "{install}", a "npx" na "{npx}".',

  declinedRun:
    'Uruchom swoje polecenie testów z PW_PERF_MODE=thresholds i zacommituj pliki pw-perf-thresholds*.json, potem PW_PERF_MODE=test wykonuje pomiar (np. {example}).',
  stepProject: 'Paczka i projekt',
  about1:
    '{pkg} mierzy czasy odpowiedzi endpointów backendu (i opcjonalnie bloków test.step) w Twoich istniejących testach e2e, bez zmian w testach.',
  about2:
    'Run pomiarowy to Twoje zwykłe polecenie testów z ustawionym PW_PERF_MODE, wykonane kilka razy na 1 workerze.',
  about3: 'Paczka sama wyznacza progi i zapisuje je do plików, które commitujesz do repozytorium.',
  about4: 'Przy regresji wydajności run się oblewa i zostawia raport HTML.',
  stepScript: 'Polecenie testów',
  scriptLesson:
    'Pomiar używa Twojego polecenia testów, więc jego kroki przygotowania, zmienne i flagi działają bez zmian. Skrypty uruchamiające playwright test:',
  scriptPlain: 'zwykłe playwright test',
  scriptQuestion: 'Które polecenie uruchamia testy do pomiaru? [1-{count}]',
  scriptSelectsTests:
    'Ten skrypt sam wybiera testy (--grep albo ścieżki plików), więc pytanie o @perf jest pominięte.',
  scriptFlagMessage: 'Skrypt "{name}" ma flagi, które psują run pomiarowy: {flags}.',
  scriptFlagHint:
    'Dodaj skrypt bez nich (np. "{name}:perf") i wybierz go przy ponownym uruchomieniu init. Skrypt nie został zmieniony.',
  flagInteractive: 'run interaktywny, pomiar bez sensu',
  flagSharded: 'run podzielony (RUN_SHARDED, kod 3)',
  flagReporter: 'zastępuje reporter paczki: brak raportu i outcome.json',
  flagChangingTests: 'testy zmieniają się między runami, więc klucze i progi się rozjeżdżają',
  flagConditions: 'nadpisuje warunki runu trybu perfo',
  laterStepsMessage:
    'Skrypt "{name}" wykonuje po Playwrighcie dalsze kroki, także w runie pomiarowym: {steps}.',
  laterStepsHint:
    'Jeśli nie powinny się wtedy wykonać, dodaj skrypt bez nich; kreator go nie tworzy.',
  oldScripts: 'Skrypty perf:* z wcześniejszej wersji kreatora ({names}) już nie działają; usuń je.',
  stepProjects: 'Projekty',
  projectsLesson:
    "Mierzone projekty wykonują się w każdym przebiegu; projekty setup i teardown raz na przebieg, jak zwykle. Testy korzystające tylko z fixture'u request niczego nie mierzą.",
  projectHelper: 'setup/teardown, wykonuje się jako zależność',
  projectApi: 'wygląda na testy API: requesty spoza przeglądarki nie są mierzone',
  projectsQuestion: 'Które projekty mierzyć? (numery po przecinku)',
  projectsNeedScript: 'Skrypt uruchamia --project {names}: zostaw te projekty zaznaczone.',
  taggedSaved: '@perf trafia do pw-perf.config.ts jako run.grep; polecenia zostają bez zmian.',
  stepPreset: 'Zapas progów',
  presetLesson: 'Progi to czasy z runu progów plus zapas. Preset ustala zapas wszystkich reguł:',
  presetStrict:
    'strict: mały zapas; łapie mniejsze regresje, częściej fałszywe alarmy na niestabilnym środowisku.',
  presetNormal: 'normal: zalecany na start.',
  presetLoose:
    'loose: duży zapas; tylko wyraźne regresje, dla współdzielonych i hałaśliwych środowisk.',
  presetQuestion: 'Jaki zapas mają mieć wyznaczone progi? [strict/normal/loose]',
  ci1: 'Progi wyznaczaj na maszynach CI, które będą mierzyć: czasy z laptopa się nie przenoszą.',
  ci2: 'Job CI uruchamiany ręcznie z PW_PERF_MODE=thresholds zapisuje pliki progów jako artefakt.',
  ci3: 'Pobierz je i zacommituj do repozytorium.',
  ci4: 'Job cykliczny (domyślnie raz w tygodniu) z PW_PERF_MODE=test oblewa się przy regresji.',
  ciQuestion: 'Dodać joby CI dla runów progów i pomiarowych ({platform})?',
  stepCheck: 'Sprawdzenie',
  checkLesson:
    'Sprawdzenie uruchamia kilka testów raz i pokazuje, co zostanie zmierzone i ile potrwa pełny run. Niczego nie ocenia ani nie zapisuje.',
  checkQuestion: 'Uruchomić sprawdzenie teraz?',
  checkManual: 'Uruchom je sam: {command}',
  checkExit: 'Sprawdzenie zakończyło się kodem {code}.',
  boxTitle: 'Wymagane działanie: na razie nic nie jest mierzone',
  boxWhy:
    "Bez fixture'u perf paczka nie mierzy żadnego requestu. Kreator nie zmienia plików testów; dodaj ręcznie jeden z wariantów:",
  boxFixtures: "Jeśli masz plik fixture'ów, który eksportuje test:",
  boxFixturesFiles: 'Pliki z .extend(): {files}',
  boxImports:
    'Jeśli testy importują test z @playwright/test (plików: {count}), zmień import w każdym z nich:',
  boxDocs: 'Inne układy (mergeTests, kilka obiektów test, playwright-bdd): {url}',
  runLine: 'Uruchomienie: {command}',
  runLesson: 'Pomiar to Twoje zwykłe polecenie testów z ustawionym PW_PERF_MODE.',
  nextCheck: '{command}: zobacz, co zostanie zmierzone i ile potrwa pełny run.',
  nextThresholds:
    '{command}: najpierw wyznacz progi na maszynach CI, które będą mierzyć: uruchom ręczny job progów w CI (albo to polecenie tam) i pobierz pliki progów z jego artefaktu. Dopóki ich nie ma, runy pomiarowe używają luźnych progów domyślnych. {estimate}',
  nextThresholdsNoCi:
    '{command}: najpierw wyznacz progi na maszynach CI, które będą mierzyć (zobacz {url}). Dopóki plików progów nie ma, runy pomiarowe używają luźnych progów domyślnych. {estimate}',
  estimateUnknown: '(Szacunek czasu da polecenie sprawdzenia.)',
  estimateAbove: '(Szacunek czasu jest w wyniku sprawdzenia powyżej.)',
  nextCommit: 'Zacommituj {files}.',
  nextTest:
    '{command}: run pomiarowy, który oblewa się przy regresji. Wyniki: {report}; szczegóły kodu wyjścia: {outcome}.',
  nextCiJobs: 'Job pomiarowy w {path} działa raz w tygodniu i można go uruchomić ręcznie.',
  windowsNote: 'Postacie tych poleceń dla PowerShell i cmd: docs/cli.md.',
};

const es: Messages = {
  declinedInstalled: '{pkg} está instalado; no se modificó ningún archivo.',
  declinedSteps: 'Para configurarlo a mano:',
  declinedConfig:
    'Envuelve la configuración exportada en playwright.config con withPerf() de {config}.',
  declinedTest:
    'Envuelve tu objeto test con withPerfFixtures() de {fixture}, o importa test de {test} en lugar de @playwright/test.',
  declinedDocs: 'Guía: {url}',
  declinedLater: 'Ejecuta {init} cuando quieras para la configuración guiada.',
  noTerminal:
    'sin terminal: se usan las respuestas por defecto y no se escribe nada Ejecuta la configuración de nuevo en un terminal para escribir los cambios.',
  dryRun: 'simulación: se muestran los cambios previstos y no se escribe nada.',
  interrupted: 'interrumpido.',
  answerAgain: 'Responde de nuevo: ese valor no es válido aquí.',
  pressEnter: 'Pulsa Enter para continuar.',
  yes: 'sí',
  no: 'no',
  yesShort: 's',
  noShort: 'n',
  projectLine: '{config} · Playwright {version} · {manager} · {modules}',
  versionUnknown: 'versión desconocida',
  testDirLine:
    'Directorio de tests "{dir}" · archivos que importan @playwright/test: {imports} · archivos que llaman a .extend(): {extend}',
  projectsPart: 'proyectos {names}',
  ciLine: 'CI: {platform}',
  ciNone: 'no encontrado',
  alreadySetUp: 'Ya configurado: {items}',
  measuredTestObject: 'objeto test medido',
  stepTests: 'Qué tests',
  testsLesson:
    'Una medición dura unas (tests × pasadas) ejecuciones de tests en 1 worker, así que mide los tests que llaman a los endpoints importantes del backend.',
  taggedFiles: 'Archivos con tests etiquetados @perf: {count}.',
  noTaggedMessage: 'Ningún test tiene aún la etiqueta @perf; se miden todos los tests.',
  noTaggedHint:
    "Para medir solo algunos tests, etiquétalos con test('título', { tag: '@perf' }, ...) y elige @perf.",
  scopeQuestion: '¿Medir todos los tests o solo los etiquetados @perf? [{all}/@perf]',
  scopeAll: 'todos',
  stepPasses: 'Pasadas',
  passesLesson:
    'Cada regla necesita un mínimo de muestras por endpoint (minSamples), y las muestras son llamadas por test × tests × pasadas. Tu comando de tests, con sus pasos de preparación, se ejecuta una vez por pasada.',
  passesQuestion: '¿Pasadas del comando de tests en las mediciones?',
  stepSteps: 'Pasos del test',
  stepsLesson:
    'También se puede medir la duración de tus bloques test.step sin cambiar los tests: cada paso se convierte en una clave como "checkout › pay".',
  stepsPrivacy:
    'Los títulos de los pasos se sanean: ids, correos, URL y secretos nunca llegan a las claves, tampoco entre comillas.',
  stepsQuestion:
    '¿Medir también la duración de tus bloques test.step (encontrados en {count} archivos)?',
  stepCi: 'CI',
  noCi: 'No se encontró configuración de CI. Recetas para GitHub Actions, GitLab CI, Jenkins y Azure Pipelines: {url}',
  stepChanges: 'Cambios',
  nothingToChange: 'Nada que cambiar: el proyecto ya está configurado para estas respuestas.',
  changesLesson: 'Cada cambio se muestra como diff antes de aplicarlo.',
  newFile: 'archivo nuevo',
  modifiedFile: 'cambio',
  overwriteQuestion: '{path} ya existe. ¿Sobrescribirlo?',
  kept: '{path} ya existe y se conserva.',
  applyQuestion: '¿Aplicar este cambio?',
  fileWritten: 'Escrito: {path}',
  skipped: 'Omitido.',
  stepSummary: 'Resumen',
  changedFiles: 'Archivos modificados:',
  noFilesChanged: 'No se modificó ningún archivo.',
  plannedChanges: 'Cambios previstos (no escritos):',
  manualSteps: 'Pasos manuales: {count} (ver las advertencias de arriba).',
  nextSteps: 'Siguientes pasos:',
  nextJenkins: 'Crea un job Pipeline en Jenkins con la ruta de script {path}.',
  nextAzure: 'Crea un pipeline en Azure DevOps a partir de {path}.',
  nextApply: 'Aplica los cambios de arriba (ejecuta la configuración de nuevo en un terminal).',
  originsNote:
    'Las claves de endpoint del origen de baseURL no llevan etiqueta y los demás hosts se etiquetan con su host; define etiquetas más cortas para ellos en keys.origins de pw-perf.config.ts.',
  docs: 'Documentación: {links}',
  finished: 'Configuración terminada.',
  noConfigMessage: 'No hay playwright.config.* en {dir}.',
  noConfigHint:
    'Ejecuta "{command}" en el directorio de playwright.config (en un monorepo: el paquete con los tests de Playwright).',
  tooOldMessage:
    '@playwright/test {version} es anterior a {min}, la versión mínima que admite {pkg}.',
  tooOldHint: 'Actualiza @playwright/test a {min} o posterior y ejecuta "{command}" de nuevo.',
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
  manualCiKept: '{file} ya existe y no se modificó.',
  manualCiHint: 'Compáralo con examples/ci/ del repositorio de {pkg}.',
  manualGitlabInclude: '.gitlab-ci.yml no se modificó: incluye en él el nuevo archivo del job.',
  manualNpmOne: '{files} instala las dependencias con npm.',
  manualNpmHint:
    'Este proyecto usa {manager}: sustituye "npm ci" por "{install}" y "npx" por "{npx}".',

  declinedRun:
    'Ejecuta tu comando de tests con PW_PERF_MODE=thresholds y haz commit de los archivos pw-perf-thresholds*.json; después PW_PERF_MODE=test ejecuta la medición (p. ej. {example}).',
  stepProject: 'Paquete y proyecto',
  about1:
    '{pkg} mide los tiempos de respuesta de los endpoints del backend (y opcionalmente tus bloques test.step) en los tests e2e que ya tienes, sin cambiarlos.',
  about2:
    'Una ejecución de medición es tu comando de tests habitual con PW_PERF_MODE, repetido varias veces en 1 worker.',
  about3: 'Calcula los umbrales por sí mismo y los escribe en archivos que subes al repositorio.',
  about4: 'La ejecución falla ante una regresión de rendimiento y deja un informe HTML.',
  stepScript: 'Comando de tests',
  scriptLesson:
    'La medición usa tu propio comando de tests, así que sus pasos de preparación, variables y flags funcionan tal cual. Scripts que ejecutan playwright test:',
  scriptPlain: 'playwright test sin script',
  scriptQuestion: '¿Qué comando ejecuta los tests que quieres medir? [1-{count}]',
  scriptSelectsTests:
    'Este script ya elige sus tests (--grep o rutas de archivos), así que se omite la pregunta sobre @perf.',
  scriptFlagMessage:
    'El script "{name}" tiene flags que estropean una ejecución de medición: {flags}.',
  scriptFlagHint:
    'Añade un script sin ellos (p. ej. "{name}:perf") y elígelo al volver a ejecutar init. El script no se ha cambiado.',
  flagInteractive: 'ejecución interactiva, no se mide nada útil',
  flagSharded: 'ejecución dividida (RUN_SHARDED, código 3)',
  flagReporter: 'sustituye el reporter del paquete: sin informe ni outcome.json',
  flagChangingTests: 'los tests cambian entre ejecuciones, así que claves y umbrales se desvían',
  flagConditions: 'sobrescribe las condiciones de ejecución del modo perf',
  laterStepsMessage:
    'El script "{name}" ejecuta más pasos después de Playwright, también en las mediciones: {steps}.',
  laterStepsHint:
    'Si no deben ejecutarse entonces, añade un script sin ellos; el asistente no lo crea.',
  oldScripts: 'Los scripts perf:* de un asistente anterior ({names}) ya no funcionan; elimínalos.',
  stepProjects: 'Proyectos',
  projectsLesson:
    'Los proyectos medidos se ejecutan en cada pasada; los proyectos setup y teardown una vez por pasada, como siempre. Los tests que solo usan el fixture request no miden nada.',
  projectHelper: 'setup/teardown, se ejecuta como dependencia',
  projectApi: 'parecen tests de API: las peticiones fuera del navegador no se miden',
  projectsQuestion: '¿Qué proyectos se deben medir? (números separados por comas)',
  projectsNeedScript: 'El script ejecuta --project {names}: mantén esos proyectos seleccionados.',
  taggedSaved: '@perf se guarda como run.grep en pw-perf.config.ts; tus comandos no cambian.',
  stepPreset: 'Margen de los umbrales',
  presetLesson:
    'Los umbrales son los tiempos de una ejecución de umbrales más un margen. El preset fija el margen de todas las reglas:',
  presetStrict:
    'strict: margen pequeño; detecta regresiones menores, más falsas alarmas en un entorno inestable.',
  presetNormal: 'normal: recomendado para empezar.',
  presetLoose:
    'loose: margen grande; solo regresiones claras, para entornos compartidos o ruidosos.',
  presetQuestion: '¿Cuánto margen deben tener los umbrales calculados? [strict/normal/loose]',
  ci1: 'Calcula los umbrales en las máquinas de CI que van a medir: los tiempos de un portátil no sirven allí.',
  ci2: 'Un job de CI lanzado a mano con PW_PERF_MODE=thresholds guarda los archivos de umbrales como artefacto.',
  ci3: 'Descárgalos y haz commit en el repositorio.',
  ci4: 'Un job programado (una vez por semana por defecto) con PW_PERF_MODE=test falla ante una regresión.',
  ciQuestion: '¿Añadir los jobs de CI para umbrales y mediciones ({platform})?',
  stepCheck: 'Comprobación',
  checkLesson:
    'La comprobación ejecuta unos pocos tests una vez y muestra qué se medirá y cuánto dura una ejecución completa. No evalúa ni escribe nada.',
  checkQuestion: '¿Ejecutar la comprobación ahora?',
  checkManual: 'Ejecútala tú: {command}',
  checkExit: 'La comprobación terminó con el código {code}.',
  boxTitle: 'Acción necesaria: todavía no se mide nada',
  boxWhy:
    'Sin el fixture perf el paquete no mide ninguna petición. El asistente no cambia tus archivos de tests; añade a mano una de estas opciones:',
  boxFixtures: 'Si tienes un archivo de fixtures que exporta test:',
  boxFixturesFiles: 'Archivos con .extend(): {files}',
  boxImports:
    'Si tus tests importan test de @playwright/test ({count} archivos), cambia el import en cada uno:',
  boxDocs: 'Otras estructuras (mergeTests, varios objetos test, playwright-bdd): {url}',
  runLine: 'Ejecutar: {command}',
  runLesson: 'Una medición es tu comando de tests habitual con PW_PERF_MODE.',
  nextCheck: '{command}: mira qué se medirá y cuánto dura una ejecución completa.',
  nextThresholds:
    '{command}: primero calcula los umbrales en las máquinas de CI que van a medir: lanza el job manual de umbrales (o este comando allí) y descarga los archivos de umbrales de su artefacto. Mientras no existan, las mediciones usan los umbrales por defecto, amplios. {estimate}',
  nextThresholdsNoCi:
    '{command}: primero calcula los umbrales en las máquinas de CI que van a medir (ver {url}). Mientras no existan los archivos de umbrales, las mediciones usan los umbrales por defecto, amplios. {estimate}',
  estimateUnknown: '(El comando de comprobación da una estimación.)',
  estimateAbove: '(La comprobación de arriba muestra una estimación.)',
  nextCommit: 'Haz commit de {files}.',
  nextTest:
    '{command}: una medición que falla ante una regresión. Resultados: {report}; detalles del código de salida: {outcome}.',
  nextCiJobs:
    'El job de medición en {path} se ejecuta una vez por semana y se puede lanzar a mano.',
  windowsNote: 'Formas de estos comandos para PowerShell y cmd: docs/cli.md.',
};

const fr: Messages = {
  declinedInstalled: '{pkg} est installé ; aucun fichier n’a été modifié.',
  declinedSteps: 'Pour le configurer à la main :',
  declinedConfig:
    'Enveloppez la configuration exportée de playwright.config dans withPerf() de {config}.',
  declinedTest:
    'Enveloppez votre objet test dans withPerfFixtures() de {fixture}, ou importez test depuis {test} au lieu de @playwright/test.',
  declinedDocs: 'Guide : {url}',
  declinedLater: 'Lancez {init} à tout moment pour la configuration guidée.',
  noTerminal:
    "pas de terminal : les réponses par défaut sont utilisées et rien n'est écrit Relancez la configuration dans un terminal pour écrire les modifications.",
  dryRun: "simulation : les modifications prévues sont affichées et rien n'est écrit.",
  interrupted: 'interrompu.',
  answerAgain: "Répondez à nouveau : cette valeur n'est pas valide ici.",
  pressEnter: 'Appuyez sur Entrée pour continuer.',
  yes: 'oui',
  no: 'non',
  yesShort: 'o',
  noShort: 'n',
  projectLine: '{config} · Playwright {version} · {manager} · {modules}',
  versionUnknown: 'version inconnue',
  testDirLine:
    'Répertoire des tests "{dir}" · fichiers qui importent @playwright/test : {imports} · fichiers qui appellent .extend() : {extend}',
  projectsPart: 'projets {names}',
  ciLine: 'CI : {platform}',
  ciNone: 'aucune trouvée',
  alreadySetUp: 'Déjà configuré : {items}',
  measuredTestObject: 'objet test mesuré',
  stepTests: 'Quels tests',
  testsLesson:
    'Une mesure prend environ (tests × passes) exécutions de tests sur 1 worker : mesurez donc les tests qui appellent les endpoints importants du backend.',
  taggedFiles: 'Fichiers avec des tests marqués @perf : {count}.',
  noTaggedMessage: 'Aucun test n’est encore marqué @perf ; tous les tests sont mesurés.',
  noTaggedHint:
    "Pour ne mesurer que certains tests, marquez-les avec test('titre', { tag: '@perf' }, ...) et choisissez @perf.",
  scopeQuestion: 'Mesurer tous les tests ou seulement ceux marqués @perf ? [{all}/@perf]',
  scopeAll: 'tous',
  stepPasses: 'Passes',
  passesLesson:
    'Chaque règle demande un nombre minimal d’échantillons par endpoint (minSamples), et les échantillons valent appels par test × tests × passes. Votre commande de tests, avec ses étapes de préparation, s’exécute une fois par passe.',
  passesQuestion: 'Passes de la commande de tests dans les mesures ?',
  stepSteps: 'Étapes de test',
  stepsLesson:
    'La durée de vos blocs test.step peut aussi être mesurée, sans modifier les tests : chaque étape devient une clé comme "checkout › pay".',
  stepsPrivacy:
    'Les titres des étapes sont nettoyés : identifiants, e-mails, URL et secrets n’arrivent jamais dans les clés, même entre guillemets.',
  stepsQuestion: 'Mesurer aussi la durée de vos blocs test.step (trouvés dans {count} fichiers) ?',
  stepCi: 'CI',
  noCi: 'Aucune configuration CI trouvée. Recettes pour GitHub Actions, GitLab CI, Jenkins et Azure Pipelines : {url}',
  stepChanges: 'Modifications',
  nothingToChange: 'Rien à modifier : le projet est déjà configuré pour ces réponses.',
  changesLesson: 'Chaque modification est affichée sous forme de diff avant d’être appliquée.',
  newFile: 'nouveau fichier',
  modifiedFile: 'modification',
  overwriteQuestion: '{path} existe déjà. L’écraser ?',
  kept: '{path} existe déjà et est conservé.',
  applyQuestion: 'Appliquer cette modification ?',
  fileWritten: 'Écrit : {path}',
  skipped: 'Ignoré.',
  stepSummary: 'Résumé',
  changedFiles: 'Fichiers modifiés :',
  noFilesChanged: 'Aucun fichier n’a été modifié.',
  plannedChanges: 'Modifications prévues (non écrites) :',
  manualSteps: 'Étapes manuelles : {count} (voir les avertissements ci-dessus).',
  nextSteps: 'Étapes suivantes :',
  nextJenkins: 'Créez dans Jenkins un job Pipeline avec le chemin de script {path}.',
  nextAzure: 'Créez un pipeline dans Azure DevOps à partir de {path}.',
  nextApply: 'Appliquez les modifications ci-dessus (relancez la configuration dans un terminal).',
  originsNote:
    'Les clés d’endpoint de l’origine du baseURL n’ont pas de libellé et les autres hôtes sont libellés avec leur hôte ; définissez des libellés plus courts dans keys.origins de pw-perf.config.ts.',
  docs: 'Documentation : {links}',
  finished: 'Configuration terminée.',
  noConfigMessage: 'Aucun playwright.config.* dans {dir}.',
  noConfigHint:
    'Lancez "{command}" dans le répertoire de playwright.config (dans un monorepo : le paquet qui contient les tests Playwright).',
  tooOldMessage:
    '@playwright/test {version} est antérieur à {min}, la version minimale prise en charge par {pkg}.',
  tooOldHint: 'Mettez à jour @playwright/test en {min} ou plus, puis relancez "{command}".',
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
  manualCiKept: "{file} existe déjà et n'a pas été modifié.",
  manualCiHint: 'Comparez-le avec examples/ci/ dans le dépôt de {pkg}.',
  manualGitlabInclude: ".gitlab-ci.yml n'a pas été modifié : incluez-y le nouveau fichier de job.",
  manualNpmOne: '{files} installe les dépendances avec npm.',
  manualNpmHint:
    'Ce projet utilise {manager} : remplacez "npm ci" par "{install}" et "npx" par "{npx}".',

  declinedRun:
    'Lancez votre commande de tests avec PW_PERF_MODE=thresholds et commitez les fichiers pw-perf-thresholds*.json, puis PW_PERF_MODE=test lance la mesure (par ex. {example}).',
  stepProject: 'Paquet et projet',
  about1:
    '{pkg} mesure les temps de réponse des endpoints du backend (et, en option, vos blocs test.step) dans les tests e2e que vous avez déjà, sans les modifier.',
  about2:
    'Une exécution de mesure est votre commande de tests habituelle avec PW_PERF_MODE, lancée plusieurs fois sur 1 worker.',
  about3:
    'Il calcule lui-même les seuils et les écrit dans des fichiers que vous commitez dans le dépôt.',
  about4: 'L’exécution échoue en cas de régression de performance et laisse un rapport HTML.',
  stepScript: 'Commande de tests',
  scriptLesson:
    'La mesure utilise votre propre commande de tests : ses étapes de préparation, variables et options fonctionnent telles quelles. Scripts qui lancent playwright test :',
  scriptPlain: 'playwright test sans script',
  scriptQuestion: 'Quelle commande lance les tests à mesurer ? [1-{count}]',
  scriptSelectsTests:
    'Ce script choisit déjà ses tests (--grep ou chemins de fichiers) : la question sur @perf est sautée.',
  scriptFlagMessage:
    'Le script "{name}" contient des options qui faussent une exécution de mesure : {flags}.',
  scriptFlagHint:
    'Ajoutez un script sans elles (par ex. "{name}:perf") et choisissez-le en relançant init. Le script n’a pas été modifié.',
  flagInteractive: 'exécution interactive, rien d’utile n’est mesuré',
  flagSharded: 'exécution découpée (RUN_SHARDED, code 3)',
  flagReporter: 'remplace le reporter du paquet : ni rapport ni outcome.json',
  flagChangingTests: 'les tests changent d’une exécution à l’autre, clés et seuils dérivent',
  flagConditions: 'écrase les conditions d’exécution du mode perf',
  laterStepsMessage:
    'Le script "{name}" exécute d’autres étapes après Playwright, aussi pendant les mesures : {steps}.',
  laterStepsHint:
    'Si elles ne doivent pas s’exécuter alors, ajoutez un script sans elles ; l’assistant ne le crée pas.',
  oldScripts:
    'Les scripts perf:* d’un assistant précédent ({names}) ne fonctionnent plus ; supprimez-les.',
  stepProjects: 'Projets',
  projectsLesson:
    'Les projets mesurés s’exécutent à chaque passage ; les projets setup et teardown une fois par passage, comme d’habitude. Les tests qui n’utilisent que la fixture request ne mesurent rien.',
  projectHelper: 'setup/teardown, s’exécute comme dépendance',
  projectApi: 'ressemble à des tests d’API : les requêtes hors navigateur ne sont pas mesurées',
  projectsQuestion: 'Quels projets mesurer ? (numéros séparés par des virgules)',
  projectsNeedScript: 'Le script lance --project {names} : gardez ces projets sélectionnés.',
  taggedSaved:
    '@perf est enregistré comme run.grep dans pw-perf.config.ts ; vos commandes restent les mêmes.',
  stepPreset: 'Marge des seuils',
  presetLesson:
    'Les seuils sont les temps d’une exécution de seuils plus une marge. Le preset fixe la marge de toutes les règles :',
  presetStrict:
    'strict : petite marge ; détecte des régressions plus faibles, plus de fausses alertes sur un environnement instable.',
  presetNormal: 'normal : recommandé pour commencer.',
  presetLoose:
    'loose : grande marge ; seulement les régressions nettes, pour des environnements partagés ou bruyants.',
  presetQuestion: 'Quelle marge pour les seuils calculés ? [strict/normal/loose]',
  ci1: 'Calculez les seuils sur les machines de CI qui mesureront : les temps d’un portable ne s’y appliquent pas.',
  ci2: 'Un job de CI lancé à la main avec PW_PERF_MODE=thresholds enregistre les fichiers de seuils comme artefact.',
  ci3: 'Téléchargez-les et commitez-les dans le dépôt.',
  ci4: 'Un job planifié (une fois par semaine par défaut) avec PW_PERF_MODE=test échoue en cas de régression.',
  ciQuestion: 'Ajouter les jobs de CI pour les seuils et les mesures ({platform}) ?',
  stepCheck: 'Vérification',
  checkLesson:
    'La vérification lance quelques tests une fois et montre ce qui sera mesuré et combien de temps dure une exécution complète. Rien n’est évalué ni écrit.',
  checkQuestion: 'Lancer la vérification maintenant ?',
  checkManual: 'Lancez-la vous-même : {command}',
  checkExit: 'La vérification s’est terminée avec le code {code}.',
  boxTitle: 'Action requise : rien n’est encore mesuré',
  boxWhy:
    'Sans la fixture perf, le paquet ne mesure aucune requête. L’assistant ne modifie pas vos fichiers de tests ; ajoutez à la main l’une de ces variantes :',
  boxFixtures: 'Si vous avez un fichier de fixtures qui exporte test :',
  boxFixturesFiles: 'Fichiers avec .extend() : {files}',
  boxImports:
    'Si vos tests importent test depuis @playwright/test ({count} fichiers), changez l’import dans chacun :',
  boxDocs: 'Autres structures (mergeTests, plusieurs objets test, playwright-bdd) : {url}',
  runLine: 'Lancer : {command}',
  runLesson: 'Une mesure est votre commande de tests habituelle avec PW_PERF_MODE.',
  nextCheck:
    '{command} : voyez ce qui sera mesuré et combien de temps dure une exécution complète.',
  nextThresholds:
    '{command} : calculez d’abord les seuils sur les machines de CI qui mesureront : lancez le job manuel de seuils (ou cette commande là-bas) et téléchargez les fichiers de seuils depuis son artefact. Tant qu’ils n’existent pas, les mesures utilisent les seuils par défaut, larges. {estimate}',
  nextThresholdsNoCi:
    '{command} : calculez d’abord les seuils sur les machines de CI qui mesureront (voir {url}). Tant que les fichiers de seuils n’existent pas, les mesures utilisent les seuils par défaut, larges. {estimate}',
  estimateUnknown: '(La commande de vérification donne une estimation.)',
  estimateAbove: '(La vérification ci-dessus donne une estimation.)',
  nextCommit: 'Commitez {files}.',
  nextTest:
    '{command} : une mesure qui échoue en cas de régression. Résultats : {report} ; détail du code de sortie : {outcome}.',
  nextCiJobs:
    'Le job de mesure dans {path} s’exécute une fois par semaine et peut être lancé à la main.',
  windowsNote: 'Formes de ces commandes pour PowerShell et cmd : docs/cli.md.',
};

const it: Messages = {
  declinedInstalled: '{pkg} è installato; nessun file è stato modificato.',
  declinedSteps: 'Per configurarlo a mano:',
  declinedConfig:
    'Avvolgi la configurazione esportata in playwright.config con withPerf() da {config}.',
  declinedTest:
    'Avvolgi il tuo oggetto test con withPerfFixtures() da {fixture}, oppure importa test da {test} invece che da @playwright/test.',
  declinedDocs: 'Guida: {url}',
  declinedLater: 'Esegui {init} in qualsiasi momento per la configurazione guidata.',
  noTerminal:
    'nessun terminale: vengono usate le risposte predefinite e non viene scritto nulla Esegui di nuovo la configurazione in un terminale per scrivere le modifiche.',
  dryRun: 'simulazione: vengono mostrate le modifiche previste e non viene scritto nulla.',
  interrupted: 'interrotto.',
  answerAgain: 'Rispondi di nuovo: quel valore non è valido qui.',
  pressEnter: 'Premi Invio per continuare.',
  yes: 'sì',
  no: 'no',
  yesShort: 's',
  noShort: 'n',
  projectLine: '{config} · Playwright {version} · {manager} · {modules}',
  versionUnknown: 'versione sconosciuta',
  testDirLine:
    'Cartella dei test "{dir}" · file che importano @playwright/test: {imports} · file che chiamano .extend(): {extend}',
  projectsPart: 'progetti {names}',
  ciLine: 'CI: {platform}',
  ciNone: 'non trovata',
  alreadySetUp: 'Già configurato: {items}',
  measuredTestObject: 'oggetto test misurato',
  stepTests: 'Quali test',
  testsLesson:
    'Una misurazione richiede circa (test × passaggi) esecuzioni di test su 1 worker, quindi misura i test che chiamano gli endpoint importanti del backend.',
  taggedFiles: 'File con test contrassegnati @perf: {count}.',
  noTaggedMessage: 'Nessun test ha ancora il tag @perf; vengono misurati tutti i test.',
  noTaggedHint:
    "Per misurare solo alcuni test, contrassegnali con test('titolo', { tag: '@perf' }, ...) e scegli @perf.",
  scopeQuestion: 'Misurare tutti i test o solo quelli contrassegnati @perf? [{all}/@perf]',
  scopeAll: 'tutti',
  stepPasses: 'Passaggi',
  passesLesson:
    'Ogni regola richiede un numero minimo di campioni per endpoint (minSamples), e i campioni sono chiamate per test × test × passaggi. Il comando dei test, con i suoi passi di preparazione, viene eseguito una volta per passaggio.',
  passesQuestion: 'Passaggi del comando dei test nelle misurazioni?',
  stepSteps: 'Step dei test',
  stepsLesson:
    'Si può misurare anche la durata dei blocchi test.step, senza modificare i test: ogni step diventa una chiave come "checkout › pay".',
  stepsPrivacy:
    'I titoli degli step vengono ripuliti: id, e-mail, URL e segreti non finiscono mai nelle chiavi, nemmeno tra virgolette.',
  stepsQuestion: 'Misurare anche la durata dei blocchi test.step (trovati in {count} file)?',
  stepCi: 'CI',
  noCi: 'Nessuna configurazione CI trovata. Ricette per GitHub Actions, GitLab CI, Jenkins e Azure Pipelines: {url}',
  stepChanges: 'Modifiche',
  nothingToChange: 'Niente da modificare: il progetto è già configurato per queste risposte.',
  changesLesson: 'Ogni modifica viene mostrata come diff prima di essere applicata.',
  newFile: 'nuovo file',
  modifiedFile: 'modifica',
  overwriteQuestion: '{path} esiste già. Sovrascriverlo?',
  kept: '{path} esiste già e viene mantenuto.',
  applyQuestion: 'Applicare questa modifica?',
  fileWritten: 'Scritto: {path}',
  skipped: 'Saltato.',
  stepSummary: 'Riepilogo',
  changedFiles: 'File modificati:',
  noFilesChanged: 'Nessun file è stato modificato.',
  plannedChanges: 'Modifiche previste (non scritte):',
  manualSteps: 'Passi manuali: {count} (vedi gli avvisi sopra).',
  nextSteps: 'Prossimi passi:',
  nextJenkins: 'Crea in Jenkins un job Pipeline con il percorso dello script {path}.',
  nextAzure: 'Crea una pipeline in Azure DevOps da {path}.',
  nextApply: 'Applica le modifiche sopra (esegui di nuovo la configurazione in un terminale).',
  originsNote:
    'Le chiavi di endpoint dell’origine di baseURL non hanno etichetta e gli altri host sono etichettati con il loro host; imposta etichette più brevi in keys.origins di pw-perf.config.ts.',
  docs: 'Documentazione: {links}',
  finished: 'Configurazione completata.',
  noConfigMessage: 'Nessun playwright.config.* in {dir}.',
  noConfigHint:
    'Esegui "{command}" nella cartella di playwright.config (in un monorepo: il pacchetto con i test Playwright).',
  tooOldMessage:
    '@playwright/test {version} è precedente a {min}, la versione minima supportata da {pkg}.',
  tooOldHint: 'Aggiorna @playwright/test a {min} o successiva, poi esegui di nuovo "{command}".',
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
  manualCiKept: '{file} esiste già e non è stato modificato.',
  manualCiHint: 'Confrontalo con examples/ci/ nel repository di {pkg}.',
  manualGitlabInclude: '.gitlab-ci.yml non è stato modificato: includi il nuovo file del job.',
  manualNpmOne: '{files} installa le dipendenze con npm.',
  manualNpmHint:
    'Questo progetto usa {manager}: sostituisci "npm ci" con "{install}" e "npx" con "{npx}".',

  declinedRun:
    'Esegui il tuo comando di test con PW_PERF_MODE=thresholds e fai commit dei file pw-perf-thresholds*.json, poi PW_PERF_MODE=test esegue la misurazione (es. {example}).',
  stepProject: 'Pacchetto e progetto',
  about1:
    '{pkg} misura i tempi di risposta degli endpoint del backend (e, se vuoi, i tuoi blocchi test.step) nei test e2e che hai già, senza modificarli.',
  about2:
    'Un’esecuzione di misura è il tuo solito comando di test con PW_PERF_MODE, ripetuto più volte su 1 worker.',
  about3: 'Calcola da solo le soglie e le scrive in file da committare nel repository.',
  about4: 'L’esecuzione fallisce in caso di regressione delle prestazioni e lascia un report HTML.',
  stepScript: 'Comando di test',
  scriptLesson:
    'La misura usa il tuo comando di test, quindi passi di preparazione, variabili e flag funzionano così come sono. Script che eseguono playwright test:',
  scriptPlain: 'playwright test senza script',
  scriptQuestion: 'Quale comando esegue i test da misurare? [1-{count}]',
  scriptSelectsTests:
    'Questo script sceglie già i suoi test (--grep o percorsi di file), quindi la domanda su @perf viene saltata.',
  scriptFlagMessage:
    'Lo script "{name}" ha flag che compromettono un’esecuzione di misura: {flags}.',
  scriptFlagHint:
    'Aggiungi uno script senza di essi (es. "{name}:perf") e sceglilo rieseguendo init. Lo script non è stato modificato.',
  flagInteractive: 'esecuzione interattiva, non si misura nulla di utile',
  flagSharded: 'esecuzione divisa (RUN_SHARDED, codice 3)',
  flagReporter: 'sostituisce il reporter del pacchetto: niente report né outcome.json',
  flagChangingTests:
    'i test cambiano tra un’esecuzione e l’altra, quindi chiavi e soglie divergono',
  flagConditions: 'sovrascrive le condizioni di esecuzione della modalità perf',
  laterStepsMessage:
    'Lo script "{name}" esegue altri passi dopo Playwright, anche nelle misure: {steps}.',
  laterStepsHint:
    'Se non devono essere eseguiti allora, aggiungi uno script senza di essi; la procedura non lo crea.',
  oldScripts:
    'Gli script perf:* di una procedura precedente ({names}) non funzionano più; rimuovili.',
  stepProjects: 'Progetti',
  projectsLesson:
    'I progetti misurati vengono eseguiti a ogni passata; i progetti setup e teardown una volta per passata, come sempre. I test che usano solo la fixture request non misurano nulla.',
  projectHelper: 'setup/teardown, eseguito come dipendenza',
  projectApi: 'sembrano test di API: le richieste fuori dal browser non vengono misurate',
  projectsQuestion: 'Quali progetti misurare? (numeri separati da virgole)',
  projectsNeedScript: 'Lo script esegue --project {names}: lascia selezionati questi progetti.',
  taggedSaved:
    '@perf viene salvato come run.grep in pw-perf.config.ts; i tuoi comandi restano uguali.',
  stepPreset: 'Margine delle soglie',
  presetLesson:
    'Le soglie sono i tempi di un’esecuzione delle soglie più un margine. Il preset imposta il margine di tutte le regole:',
  presetStrict:
    'strict: margine piccolo; rileva regressioni minori, più falsi allarmi su un ambiente instabile.',
  presetNormal: 'normal: consigliato per iniziare.',
  presetLoose:
    'loose: margine ampio; solo regressioni evidenti, per ambienti condivisi o rumorosi.',
  presetQuestion: 'Quanto margine devono avere le soglie calcolate? [strict/normal/loose]',
  ci1: 'Calcola le soglie sulle macchine di CI che misureranno: i tempi di un portatile non valgono lì.',
  ci2: 'Un job di CI avviato a mano con PW_PERF_MODE=thresholds salva i file delle soglie come artefatto.',
  ci3: 'Scaricali e fanne commit nel repository.',
  ci4: 'Un job pianificato (una volta a settimana per impostazione predefinita) con PW_PERF_MODE=test fallisce in caso di regressione.',
  ciQuestion: 'Aggiungere i job di CI per soglie e misure ({platform})?',
  stepCheck: 'Verifica',
  checkLesson:
    'La verifica esegue pochi test una volta e mostra cosa verrà misurato e quanto dura un’esecuzione completa. Non valuta né scrive nulla.',
  checkQuestion: 'Eseguire la verifica adesso?',
  checkManual: 'Eseguila tu: {command}',
  checkExit: 'La verifica è terminata con il codice {code}.',
  boxTitle: 'Azione richiesta: per ora non si misura nulla',
  boxWhy:
    'Senza la fixture perf il pacchetto non misura alcuna richiesta. La procedura non modifica i tuoi file di test; aggiungi a mano una di queste varianti:',
  boxFixtures: 'Se hai un file di fixture che esporta test:',
  boxFixturesFiles: 'File con .extend(): {files}',
  boxImports:
    'Se i tuoi test importano test da @playwright/test ({count} file), cambia l’import in ognuno:',
  boxDocs: 'Altre strutture (mergeTests, più oggetti test, playwright-bdd): {url}',
  runLine: 'Esegui: {command}',
  runLesson: 'Una misura è il tuo solito comando di test con PW_PERF_MODE.',
  nextCheck: '{command}: guarda cosa verrà misurato e quanto dura un’esecuzione completa.',
  nextThresholds:
    '{command}: prima calcola le soglie sulle macchine di CI che misureranno: avvia il job manuale delle soglie (o questo comando lì) e scarica i file delle soglie dal suo artefatto. Finché non esistono, le misure usano le soglie predefinite, larghe. {estimate}',
  nextThresholdsNoCi:
    '{command}: prima calcola le soglie sulle macchine di CI che misureranno (vedi {url}). Finché i file delle soglie non esistono, le misure usano le soglie predefinite, larghe. {estimate}',
  estimateUnknown: '(Il comando di verifica fornisce una stima.)',
  estimateAbove: '(La verifica qui sopra mostra una stima.)',
  nextCommit: 'Fai commit di {files}.',
  nextTest:
    '{command}: una misura che fallisce in caso di regressione. Risultati: {report}; dettagli del codice di uscita: {outcome}.',
  nextCiJobs:
    'Il job di misura in {path} viene eseguito una volta a settimana e può essere avviato a mano.',
  windowsNote: 'Forme di questi comandi per PowerShell e cmd: docs/cli.md.',
};

const uk: Messages = {
  declinedInstalled: '{pkg} встановлено; жоден файл не змінено.',
  declinedSteps: 'Щоб налаштувати вручну:',
  declinedConfig:
    'Обгорніть експортовану конфігурацію в playwright.config у withPerf() з {config}.',
  declinedTest:
    'Обгорніть свій об’єкт test у withPerfFixtures() з {fixture} або імпортуйте test з {test} замість @playwright/test.',
  declinedDocs: 'Посібник: {url}',
  declinedLater: 'Запустіть {init} будь-коли для налаштування з підказками.',
  noTerminal:
    'немає термінала: використовуються типові відповіді, нічого не записується Запустіть налаштування ще раз у терміналі, щоб записати зміни.',
  dryRun: 'пробний запуск: показано заплановані зміни, нічого не записується.',
  interrupted: 'перервано.',
  answerAgain: 'Відповідайте ще раз: це значення тут не підходить.',
  pressEnter: 'Натисніть Enter, щоб продовжити.',
  yes: 'так',
  no: 'ні',
  yesShort: 'т',
  noShort: 'н',
  projectLine: '{config} · Playwright {version} · {manager} · {modules}',
  versionUnknown: 'версія невідома',
  testDirLine:
    'Каталог тестів "{dir}" · файли, що імпортують @playwright/test: {imports} · файли, що викликають .extend(): {extend}',
  projectsPart: 'проєкти {names}',
  ciLine: 'CI: {platform}',
  ciNone: 'не знайдено',
  alreadySetUp: 'Уже налаштовано: {items}',
  measuredTestObject: 'вимірюваний об’єкт test',
  stepTests: 'Які тести',
  testsLesson:
    'Вимірювання триває приблизно (тести × проходи) запусків тестів на 1 worker, тож вимірюйте тести, що викликають важливі ендпоінти бекенду.',
  taggedFiles: 'Файли з тестами з тегом @perf: {count}.',
  noTaggedMessage: 'Жоден тест ще не має тегу @perf; вимірюються всі тести.',
  noTaggedHint:
    "Щоб вимірювати лише частину тестів, позначте їх: test('назва', { tag: '@perf' }, ...) і виберіть @perf.",
  scopeQuestion: 'Вимірювати всі тести чи лише з тегом @perf? [{all}/@perf]',
  scopeAll: 'усі',
  stepPasses: 'Проходи',
  passesLesson:
    'Кожне правило потребує мінімальної кількості вимірів на ендпоінт (minSamples), а вимірів буде: виклики в тесті × тести × проходи. Команда тестів разом із кроками підготовки виконується один раз на прохід.',
  passesQuestion: 'Скільки проходів команди тестів під час вимірювання?',
  stepSteps: 'Кроки тестів',
  stepsLesson:
    'Тривалість блоків test.step теж можна вимірювати без змін у тестах: кожен крок стає ключем, наприклад "checkout › pay".',
  stepsPrivacy:
    'Заголовки кроків очищуються: ідентифікатори, e-mail, URL і секрети ніколи не потрапляють у ключі, навіть у лапках.',
  stepsQuestion: 'Також вимірювати тривалість блоків test.step (знайдено у файлах: {count})?',
  stepCi: 'CI',
  noCi: 'Конфігурацію CI не знайдено. Рецепти для GitHub Actions, GitLab CI, Jenkins та Azure Pipelines: {url}',
  stepChanges: 'Зміни',
  nothingToChange: 'Нічого змінювати: проєкт уже налаштовано для цих відповідей.',
  changesLesson: 'Кожну зміну показано як diff, перш ніж її застосувати.',
  newFile: 'новий файл',
  modifiedFile: 'зміна',
  overwriteQuestion: '{path} уже існує. Перезаписати?',
  kept: '{path} уже існує і залишається без змін.',
  applyQuestion: 'Застосувати цю зміну?',
  fileWritten: 'Записано: {path}',
  skipped: 'Пропущено.',
  stepSummary: 'Підсумок',
  changedFiles: 'Змінені файли:',
  noFilesChanged: 'Жоден файл не змінено.',
  plannedChanges: 'Заплановані зміни (не записані):',
  manualSteps: 'Ручні кроки: {count} (див. попередження вище).',
  nextSteps: 'Наступні кроки:',
  nextJenkins: 'Створіть у Jenkins job типу Pipeline зі шляхом до скрипта {path}.',
  nextAzure: 'Створіть pipeline в Azure DevOps з {path}.',
  nextApply: 'Застосуйте зміни вище (запустіть налаштування ще раз у терміналі).',
  originsNote:
    'Ключі ендпоінтів origin з baseURL не мають мітки, а інші хости позначаються своїм хостом; коротші мітки для них задайте в keys.origins у pw-perf.config.ts.',
  docs: 'Документація: {links}',
  finished: 'Налаштування завершено.',
  noConfigMessage: 'У {dir} немає playwright.config.*.',
  noConfigHint:
    'Запустіть "{command}" у каталозі з playwright.config (у монорепозиторії: у пакеті з тестами Playwright).',
  tooOldMessage:
    '@playwright/test {version} старіший за {min}, найнижчу версію, яку підтримує {pkg}.',
  tooOldHint: 'Оновіть @playwright/test до {min} або новішої, потім знову запустіть "{command}".',
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
  manualCiKept: '{file} уже існує і не змінювався.',
  manualCiHint: 'Порівняйте його з examples/ci/ у репозиторії {pkg}.',
  manualGitlabInclude: '.gitlab-ci.yml не змінено: підключіть у ньому новий файл job.',
  manualNpmOne: '{files} встановлює залежності через npm.',
  manualNpmHint:
    'Цей проєкт використовує {manager}: замініть "npm ci" на "{install}", а "npx" на "{npx}".',

  declinedRun:
    'Запустіть свою команду тестів з PW_PERF_MODE=thresholds і закомітьте файли pw-perf-thresholds*.json, потім PW_PERF_MODE=test виконує вимірювання (напр. {example}).',
  stepProject: 'Пакет і проєкт',
  about1:
    '{pkg} вимірює час відповіді ендпоінтів бекенду (і за бажанням ваших блоків test.step) у наявних e2e-тестах, без змін у тестах.',
  about2:
    'Вимірювальний запуск — це ваша звичайна команда тестів із PW_PERF_MODE, виконана кілька разів на 1 воркері.',
  about3: 'Пакет сам обчислює пороги й записує їх у файли, які ви комітите в репозиторій.',
  about4: 'Запуск падає при регресії продуктивності й залишає HTML-звіт.',
  stepScript: 'Команда тестів',
  scriptLesson:
    'Вимірювання використовує вашу власну команду тестів, тож її кроки підготовки, змінні й прапорці працюють як є. Скрипти, що запускають playwright test:',
  scriptPlain: 'звичайний playwright test',
  scriptQuestion: 'Яка команда запускає тести для вимірювання? [1-{count}]',
  scriptSelectsTests:
    'Цей скрипт сам вибирає тести (--grep або шляхи файлів), тому питання про @perf пропущено.',
  scriptFlagMessage: 'Скрипт "{name}" має прапорці, що псують вимірювальний запуск: {flags}.',
  scriptFlagHint:
    'Додайте скрипт без них (напр. "{name}:perf") і виберіть його під час повторного init. Скрипт не змінено.',
  flagInteractive: 'інтерактивний запуск, нічого корисного не вимірюється',
  flagSharded: 'розділений запуск (RUN_SHARDED, код 3)',
  flagReporter: 'замінює репортер пакета: немає звіту й outcome.json',
  flagChangingTests: 'тести змінюються між запусками, тож ключі й пороги розходяться',
  flagConditions: 'перевизначає умови запуску режиму perf',
  laterStepsMessage:
    'Скрипт "{name}" виконує після Playwright інші кроки, також у вимірювальних запусках: {steps}.',
  laterStepsHint:
    'Якщо вони не мають тоді виконуватися, додайте скрипт без них; майстер його не створює.',
  oldScripts:
    'Скрипти perf:* з попередньої версії майстра ({names}) більше не працюють; видаліть їх.',
  stepProjects: 'Проєкти',
  projectsLesson:
    'Вимірювані проєкти виконуються в кожному проході; проєкти setup і teardown — раз на прохід, як зазвичай. Тести лише з фікстурою request нічого не вимірюють.',
  projectHelper: 'setup/teardown, виконується як залежність',
  projectApi: 'схоже на API-тести: запити поза браузером не вимірюються',
  projectsQuestion: 'Які проєкти вимірювати? (номери через кому)',
  projectsNeedScript: 'Скрипт запускає --project {names}: залиште ці проєкти вибраними.',
  taggedSaved: '@perf зберігається як run.grep у pw-perf.config.ts; ваші команди не змінюються.',
  stepPreset: 'Запас порогів',
  presetLesson:
    'Пороги — це час із запуску порогів плюс запас. Пресет задає запас для всіх правил:',
  presetStrict:
    'strict: малий запас; ловить менші регресії, частіше хибні тривоги в нестабільному середовищі.',
  presetNormal: 'normal: рекомендовано для початку.',
  presetLoose: 'loose: великий запас; лише явні регресії, для спільних або шумних середовищ.',
  presetQuestion: 'Який запас мають мати обчислені пороги? [strict/normal/loose]',
  ci1: 'Обчислюйте пороги на тих машинах CI, які будуть вимірювати: час із ноутбука там не підходить.',
  ci2: 'Job CI, запущений вручну з PW_PERF_MODE=thresholds, зберігає файли порогів як артефакт.',
  ci3: 'Завантажте їх і закомітьте в репозиторій.',
  ci4: 'Запланований job (типово раз на тиждень) з PW_PERF_MODE=test падає при регресії.',
  ciQuestion: 'Додати job-и CI для запусків порогів і вимірювань ({platform})?',
  stepCheck: 'Перевірка',
  checkLesson:
    'Перевірка запускає кілька тестів один раз і показує, що буде виміряно і скільки триватиме повний запуск. Нічого не оцінює й не записує.',
  checkQuestion: 'Запустити перевірку зараз?',
  checkManual: 'Запустіть її самі: {command}',
  checkExit: 'Перевірка завершилася з кодом {code}.',
  boxTitle: 'Потрібна дія: поки що нічого не вимірюється',
  boxWhy:
    'Без фікстури perf пакет не вимірює жодного запиту. Майстер не змінює ваші файли тестів; додайте вручну один із варіантів:',
  boxFixtures: 'Якщо у вас є файл фікстур, що експортує test:',
  boxFixturesFiles: 'Файли з .extend(): {files}',
  boxImports:
    'Якщо тести імпортують test з @playwright/test (файлів: {count}), змініть імпорт у кожному з них:',
  boxDocs: 'Інші структури (mergeTests, кілька об’єктів test, playwright-bdd): {url}',
  runLine: 'Запуск: {command}',
  runLesson: 'Вимірювання — це ваша звичайна команда тестів із PW_PERF_MODE.',
  nextCheck: '{command}: подивіться, що буде виміряно і скільки триватиме повний запуск.',
  nextThresholds:
    '{command}: спершу обчисліть пороги на машинах CI, які будуть вимірювати: запустіть ручний job порогів (або цю команду там) і завантажте файли порогів з його артефакту. Поки їх немає, вимірювання використовують широкі типові пороги. {estimate}',
  nextThresholdsNoCi:
    '{command}: спершу обчисліть пороги на машинах CI, які будуть вимірювати (див. {url}). Поки файлів порогів немає, вимірювання використовують широкі типові пороги. {estimate}',
  estimateUnknown: '(Оцінку часу дасть команда перевірки.)',
  estimateAbove: '(Оцінка часу — у результаті перевірки вище.)',
  nextCommit: 'Закомітьте {files}.',
  nextTest:
    '{command}: вимірювальний запуск, що падає при регресії. Результати: {report}; подробиці коду виходу: {outcome}.',
  nextCiJobs: 'Вимірювальний job у {path} виконується раз на тиждень, його можна запустити вручну.',
  windowsNote: 'Форми цих команд для PowerShell і cmd: docs/cli.md.',
};

const ru: Messages = {
  declinedInstalled: '{pkg} установлен; ни один файл не изменён.',
  declinedSteps: 'Чтобы настроить вручную:',
  declinedConfig:
    'Оберните экспортируемую конфигурацию в playwright.config в withPerf() из {config}.',
  declinedTest:
    'Оберните свой объект test в withPerfFixtures() из {fixture} или импортируйте test из {test} вместо @playwright/test.',
  declinedDocs: 'Руководство: {url}',
  declinedLater: 'Запустите {init} в любой момент для настройки с подсказками.',
  noTerminal:
    'нет терминала: используются ответы по умолчанию, ничего не записывается Запустите настройку ещё раз в терминале, чтобы записать изменения.',
  dryRun: 'пробный запуск: показаны запланированные изменения, ничего не записывается.',
  interrupted: 'прервано.',
  answerAgain: 'Ответьте ещё раз: это значение здесь не подходит.',
  pressEnter: 'Нажмите Enter, чтобы продолжить.',
  yes: 'да',
  no: 'нет',
  yesShort: 'д',
  noShort: 'н',
  projectLine: '{config} · Playwright {version} · {manager} · {modules}',
  versionUnknown: 'версия неизвестна',
  testDirLine:
    'Каталог тестов "{dir}" · файлы, импортирующие @playwright/test: {imports} · файлы, вызывающие .extend(): {extend}',
  projectsPart: 'проекты {names}',
  ciLine: 'CI: {platform}',
  ciNone: 'не найдено',
  alreadySetUp: 'Уже настроено: {items}',
  measuredTestObject: 'измеряемый объект test',
  stepTests: 'Какие тесты',
  testsLesson:
    'Измерение занимает примерно (тесты × проходы) запусков тестов на 1 worker, поэтому измеряйте тесты, которые вызывают важные эндпоинты бэкенда.',
  taggedFiles: 'Файлы с тестами с тегом @perf: {count}.',
  noTaggedMessage: 'Ни у одного теста пока нет тега @perf; измеряются все тесты.',
  noTaggedHint:
    "Чтобы измерять только часть тестов, отметьте их: test('название', { tag: '@perf' }, ...) и выберите @perf.",
  scopeQuestion: 'Измерять все тесты или только с тегом @perf? [{all}/@perf]',
  scopeAll: 'все',
  stepPasses: 'Проходы',
  passesLesson:
    'Каждому правилу нужно минимальное число замеров на эндпоинт (minSamples), а замеров будет: вызовы в тесте × тесты × проходы. Команда тестов вместе с шагами подготовки выполняется один раз на проход.',
  passesQuestion: 'Сколько проходов команды тестов при измерении?',
  stepSteps: 'Шаги тестов',
  stepsLesson:
    'Длительность блоков test.step тоже можно измерять без изменений в тестах: каждый шаг становится ключом, например "checkout › pay".',
  stepsPrivacy:
    'Заголовки шагов очищаются: идентификаторы, e-mail, URL и секреты никогда не попадают в ключи, даже в кавычках.',
  stepsQuestion: 'Также измерять длительность блоков test.step (найдено в файлах: {count})?',
  stepCi: 'CI',
  noCi: 'Конфигурация CI не найдена. Рецепты для GitHub Actions, GitLab CI, Jenkins и Azure Pipelines: {url}',
  stepChanges: 'Изменения',
  nothingToChange: 'Менять нечего: проект уже настроен для этих ответов.',
  changesLesson: 'Каждое изменение показывается как diff, прежде чем его применить.',
  newFile: 'новый файл',
  modifiedFile: 'изменение',
  overwriteQuestion: '{path} уже существует. Перезаписать?',
  kept: '{path} уже существует и остаётся без изменений.',
  applyQuestion: 'Применить это изменение?',
  fileWritten: 'Записано: {path}',
  skipped: 'Пропущено.',
  stepSummary: 'Итог',
  changedFiles: 'Изменённые файлы:',
  noFilesChanged: 'Ни один файл не изменён.',
  plannedChanges: 'Запланированные изменения (не записаны):',
  manualSteps: 'Ручные шаги: {count} (см. предупреждения выше).',
  nextSteps: 'Дальнейшие шаги:',
  nextJenkins: 'Создайте в Jenkins job типа Pipeline с путём к скрипту {path}.',
  nextAzure: 'Создайте pipeline в Azure DevOps из {path}.',
  nextApply: 'Примените изменения выше (запустите настройку ещё раз в терминале).',
  originsNote:
    'Ключи эндпоинтов origin из baseURL не имеют метки, а другие хосты помечаются своим хостом; более короткие метки для них задайте в keys.origins в pw-perf.config.ts.',
  docs: 'Документация: {links}',
  finished: 'Настройка завершена.',
  noConfigMessage: 'В {dir} нет playwright.config.*.',
  noConfigHint:
    'Запустите "{command}" в каталоге с playwright.config (в монорепозитории: в пакете с тестами Playwright).',
  tooOldMessage:
    '@playwright/test {version} старше {min}, минимальной версии, которую поддерживает {pkg}.',
  tooOldHint: 'Обновите @playwright/test до {min} или новее, затем снова запустите "{command}".',
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
  manualCiKept: '{file} уже существует и не изменялся.',
  manualCiHint: 'Сравните его с examples/ci/ в репозитории {pkg}.',
  manualGitlabInclude: '.gitlab-ci.yml не изменён: подключите в нём новый файл job.',
  manualNpmOne: '{files} устанавливает зависимости через npm.',
  manualNpmHint:
    'Этот проект использует {manager}: замените "npm ci" на "{install}", а "npx" на "{npx}".',

  declinedRun:
    'Запустите свою команду тестов с PW_PERF_MODE=thresholds и закоммитьте файлы pw-perf-thresholds*.json, затем PW_PERF_MODE=test выполняет измерение (напр. {example}).',
  stepProject: 'Пакет и проект',
  about1:
    '{pkg} измеряет время ответа эндпоинтов бэкенда (и по желанию ваших блоков test.step) в уже существующих e2e-тестах, без изменений в тестах.',
  about2:
    'Измерительный запуск — это ваша обычная команда тестов с PW_PERF_MODE, выполненная несколько раз на 1 воркере.',
  about3: 'Пакет сам вычисляет пороги и записывает их в файлы, которые вы коммитите в репозиторий.',
  about4: 'Запуск падает при регрессии производительности и оставляет HTML-отчёт.',
  stepScript: 'Команда тестов',
  scriptLesson:
    'Измерение использует вашу собственную команду тестов, поэтому её шаги подготовки, переменные и флаги работают как есть. Скрипты, запускающие playwright test:',
  scriptPlain: 'обычный playwright test',
  scriptQuestion: 'Какая команда запускает тесты для измерения? [1-{count}]',
  scriptSelectsTests:
    'Этот скрипт сам выбирает тесты (--grep или пути файлов), поэтому вопрос про @perf пропущен.',
  scriptFlagMessage: 'В скрипте "{name}" есть флаги, которые портят измерительный запуск: {flags}.',
  scriptFlagHint:
    'Добавьте скрипт без них (напр. "{name}:perf") и выберите его при повторном init. Скрипт не изменён.',
  flagInteractive: 'интерактивный запуск, ничего полезного не измеряется',
  flagSharded: 'разделённый запуск (RUN_SHARDED, код 3)',
  flagReporter: 'заменяет репортер пакета: нет отчёта и outcome.json',
  flagChangingTests: 'тесты меняются между запусками, поэтому ключи и пороги расходятся',
  flagConditions: 'переопределяет условия запуска режима perf',
  laterStepsMessage:
    'Скрипт "{name}" выполняет после Playwright другие шаги, в том числе в измерительных запусках: {steps}.',
  laterStepsHint:
    'Если они не должны тогда выполняться, добавьте скрипт без них; мастер его не создаёт.',
  oldScripts: 'Скрипты perf:* из прежней версии мастера ({names}) больше не работают; удалите их.',
  stepProjects: 'Проекты',
  projectsLesson:
    'Измеряемые проекты выполняются в каждом проходе; проекты setup и teardown — раз за проход, как обычно. Тесты только с фикстурой request ничего не измеряют.',
  projectHelper: 'setup/teardown, выполняется как зависимость',
  projectApi: 'похоже на API-тесты: запросы вне браузера не измеряются',
  projectsQuestion: 'Какие проекты измерять? (номера через запятую)',
  projectsNeedScript: 'Скрипт запускает --project {names}: оставьте эти проекты выбранными.',
  taggedSaved: '@perf сохраняется как run.grep в pw-perf.config.ts; ваши команды не меняются.',
  stepPreset: 'Запас порогов',
  presetLesson:
    'Пороги — это время из запуска порогов плюс запас. Пресет задаёт запас для всех правил:',
  presetStrict:
    'strict: малый запас; ловит меньшие регрессии, чаще ложные тревоги в нестабильной среде.',
  presetNormal: 'normal: рекомендуется для начала.',
  presetLoose: 'loose: большой запас; только явные регрессии, для общих или шумных сред.',
  presetQuestion: 'Какой запас должен быть у вычисленных порогов? [strict/normal/loose]',
  ci1: 'Вычисляйте пороги на тех машинах CI, которые будут измерять: время с ноутбука там не подходит.',
  ci2: 'Job CI, запущенный вручную с PW_PERF_MODE=thresholds, сохраняет файлы порогов как артефакт.',
  ci3: 'Скачайте их и закоммитьте в репозиторий.',
  ci4: 'Запланированный job (по умолчанию раз в неделю) с PW_PERF_MODE=test падает при регрессии.',
  ciQuestion: 'Добавить job-ы CI для запусков порогов и измерений ({platform})?',
  stepCheck: 'Проверка',
  checkLesson:
    'Проверка запускает несколько тестов один раз и показывает, что будет измерено и сколько займёт полный запуск. Ничего не оценивает и не записывает.',
  checkQuestion: 'Запустить проверку сейчас?',
  checkManual: 'Запустите её сами: {command}',
  checkExit: 'Проверка завершилась с кодом {code}.',
  boxTitle: 'Требуется действие: пока ничего не измеряется',
  boxWhy:
    'Без фикстуры perf пакет не измеряет ни одного запроса. Мастер не меняет ваши файлы тестов; добавьте вручную один из вариантов:',
  boxFixtures: 'Если у вас есть файл фикстур, который экспортирует test:',
  boxFixturesFiles: 'Файлы с .extend(): {files}',
  boxImports:
    'Если тесты импортируют test из @playwright/test (файлов: {count}), измените импорт в каждом из них:',
  boxDocs: 'Другие структуры (mergeTests, несколько объектов test, playwright-bdd): {url}',
  runLine: 'Запуск: {command}',
  runLesson: 'Измерение — это ваша обычная команда тестов с PW_PERF_MODE.',
  nextCheck: '{command}: посмотрите, что будет измерено и сколько займёт полный запуск.',
  nextThresholds:
    '{command}: сначала вычислите пороги на машинах CI, которые будут измерять: запустите ручной job порогов (или эту команду там) и скачайте файлы порогов из его артефакта. Пока их нет, измерения используют широкие пороги по умолчанию. {estimate}',
  nextThresholdsNoCi:
    '{command}: сначала вычислите пороги на машинах CI, которые будут измерять (см. {url}). Пока файлов порогов нет, измерения используют широкие пороги по умолчанию. {estimate}',
  estimateUnknown: '(Оценку времени даст команда проверки.)',
  estimateAbove: '(Оценка времени — в результате проверки выше.)',
  nextCommit: 'Закоммитьте {files}.',
  nextTest:
    '{command}: измерительный запуск, который падает при регрессии. Результаты: {report}; подробности кода выхода: {outcome}.',
  nextCiJobs: 'Измерительный job в {path} выполняется раз в неделю, его можно запустить вручную.',
  windowsNote: 'Формы этих команд для PowerShell и cmd: docs/cli.md.',
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
