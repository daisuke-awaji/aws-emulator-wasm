import { expect, test } from '@playwright/test';

const SEEDS = ['AWS Emulator を wasm にビルドする', 'ブラウザの Worker で動かす', 'MSW のハンドラから DynamoDB・S3・SQS を呼ぶ'];

const watch = new WeakMap();

test.beforeEach(async ({ page }) => {
  const seen = { external: [], errors: [] };
  watch.set(page, seen);
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.protocol.startsWith('http') && !['localhost', '127.0.0.1'].includes(url.hostname)) seen.external.push(r.url());
  });
  page.on('pageerror', (e) => seen.errors.push(e.message));
  await page.goto('./');
  await expect(items(page)).toHaveCount(3, { timeout: 60_000 });
});

test.afterEach(async ({ page }) => {
  // Everything runs in the page: no request leaves the site, and nothing throws.
  const seen = watch.get(page);
  expect(seen.external).toEqual([]);
  expect(seen.errors).toEqual([]);
});

// Only the Todos themselves: an SDK trace under a Todo is a list of its own.
const items = (page) => page.getByRole('list', { name: 'Todo の一覧' }).locator(':scope > li');
// Matched on the Todo's own row: the SDK output under a Todo can mention other titles.
const item = (page, title) => items(page).filter({ has: page.locator(':scope > .row', { hasText: title }) });
const activity = (page) => page.getByRole('list', { name: '変更の記録' }).getByRole('listitem');

test('shows the seeded todos from DynamoDB', async ({ page }) => {
  await expect(items(page)).toHaveText(SEEDS.map((t) => new RegExp(t)));
  await expect(page.getByText('残り 1 件 / 全 3 件')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: `「${SEEDS[0]}」を未完了に戻す` })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: `「${SEEDS[2]}」を完了にする` })).not.toBeChecked();
});

test('add, complete, rename and delete a todo; every change shows up from SQS', async ({ page }) => {
  await page.getByLabel('新しい Todo').fill('牛乳を買う');
  await page.getByRole('button', { name: '追加' }).click();
  await expect(item(page, '牛乳を買う')).toBeVisible();
  await expect(page.getByText('残り 2 件 / 全 4 件')).toBeVisible();
  await expect(page.getByLabel('新しい Todo')).toHaveValue('');
  await expect(activity(page).first()).toContainText('追加');

  await page.getByRole('checkbox', { name: '「牛乳を買う」を完了にする' }).check();
  await expect(page.getByRole('checkbox', { name: '「牛乳を買う」を未完了に戻す' })).toBeChecked();
  await expect(page.getByText('残り 1 件 / 全 4 件')).toBeVisible();
  await expect(activity(page).first()).toContainText('完了');

  await page.getByRole('button', { name: '「牛乳を買う」を編集' }).click();
  await page.getByLabel('タイトル').fill('豆乳を買う');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(item(page, '豆乳を買う')).toBeVisible();
  await expect(item(page, '牛乳を買う')).toHaveCount(0);
  await expect(activity(page).first()).toContainText('名前を変更');

  await page.getByRole('button', { name: '「豆乳を買う」を削除' }).click();
  await expect(item(page, '豆乳を買う')).toHaveCount(0);
  await expect(page.getByText('残り 1 件 / 全 3 件')).toBeVisible();
  await expect(activity(page)).toHaveCount(4);
  await expect(activity(page).first()).toContainText('削除');
});

test('a note is saved to S3 and read back', async ({ page }) => {
  const title = SEEDS[2];
  await page.getByRole('button', { name: `「${title}」のメモ` }).click();
  const note = item(page, title).getByLabel('メモ（S3 に保存）');
  await expect(note).toHaveValue('');
  await note.fill('S3 に保存するメモ\n2 行目');
  await page.getByRole('button', { name: 'メモを保存' }).click();
  await expect(note).toHaveCount(0);
  await expect(page.getByRole('button', { name: `「${title}」のメモ` })).toHaveText('メモあり');

  await page.getByRole('button', { name: `「${title}」のメモ` }).click();
  await expect(item(page, title).getByLabel('メモ（S3 に保存）')).toHaveValue('S3 に保存するメモ\n2 行目');

  // The seeded note on the first todo comes from S3 too.
  await page.getByRole('button', { name: `「${SEEDS[0]}」のメモ` }).click();
  await expect(item(page, SEEDS[0]).getByLabel('メモ（S3 に保存）')).toHaveValue('Phase 0.5 で完了。wasm32-wasip1 向け。');
});

test('an empty title is rejected by the handler with a message', async ({ page }) => {
  await page.getByLabel('新しい Todo').fill('   ');
  await page.getByRole('button', { name: '追加' }).click();
  await expect(page.getByRole('alert')).toHaveText('タイトルを入力してください');
  await expect(items(page)).toHaveCount(3);
});

test('the REST API answers fetch() from the page through MSW', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const missing = await fetch('api/todos/nope', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"done":true}' });
    const bad = await fetch('api/todos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json' });
    const list = await (await fetch('api/todos')).json();
    return { missing: [missing.status, await missing.json()], bad: bad.status, count: list.length };
  });
  expect(result).toEqual({ missing: [404, { message: 'Todo が見つかりません' }], bad: 400, count: 3 });
});

test('the architecture diagram shows the path and the emulator is running', async ({ page }) => {
  const diagram = page.getByRole('list', { name: '構成' });
  await expect(diagram.locator('strong')).toHaveText(['React', 'MSW', 'AWS SDK v3', 'AWS Emulator（wasm）', 'DynamoDB', 'S3', 'SQS']);
  await expect(diagram.getByRole('listitem', { name: /で渡す$/ })).toHaveText(['fetch', '転送', 'postMessage']);
  await expect(diagram.getByRole('img', { name: '動作中' })).toBeVisible();
  await expect(page.getByRole('list', { name: '使っているサービス' }).getByRole('listitem')).toHaveText([/DynamoDB/, /S3/, /SQS/]);
  // The arrows never run across a box.
  const crossings = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.arch-node, .arch-emulator')].map((e) => e.getBoundingClientRect());
    const lines = [...document.querySelectorAll('.arch-edge-line, .arch-edge-label')].map((e) => e.getBoundingClientRect());
    const hit = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
    return lines.flatMap((l, i) => boxes.filter((b) => hit(l, b)).map(() => i));
  });
  expect(crossings).toEqual([]);
});

test('the SDK call log shows what one action costs, and the counter includes it', async ({ page }) => {
  const log = page.getByRole('region', { name: 'SDK の呼び出し' });
  const boot = log.getByRole('list', { name: /^起動/ });
  // Setup: table, bucket, queue and 3 seeded todos (11), then the first Scan and an empty receive.
  await expect(page.getByTestId('requests')).toHaveText('13 回');
  await expect(page.getByTestId('last-calls')).toHaveText('13 回');
  await expect(boot.getByRole('listitem')).toHaveCount(13);

  await page.getByLabel('新しい Todo').fill('牛乳を買う');
  await page.getByRole('button', { name: '追加' }).click();
  await expect(item(page, '牛乳を買う')).toBeVisible();
  const added = log.getByRole('list', { name: '「牛乳を買う」を追加 の SDK 呼び出し' }).getByRole('listitem');
  await expect(added).toHaveText([
    /POST \/api\/todos.*DynamoDB.*PutItem.*200/,
    /POST \/api\/todos.*SQS.*SendMessage.*200/,
    /GET \/api\/todos.*DynamoDB.*Scan.*200/,
    /GET \/api\/activity.*SQS.*ReceiveMessage.*200/,
    /GET \/api\/activity.*SQS.*DeleteMessageBatch.*200/,
    /GET \/api\/activity.*SQS.*ReceiveMessage.*200/,
  ]);
  await expect(page.getByTestId('last-calls')).toHaveText('6 回');
  await expect(page.getByTestId('requests')).toHaveText('19 回');

  // A rejected title makes no SDK call at all.
  await page.getByLabel('新しい Todo').fill('   ');
  await page.getByRole('button', { name: '追加' }).click();
  await expect(page.getByRole('alert')).toHaveText('タイトルを入力してください');
  await expect(page.getByTestId('last-calls')).toHaveText('0 回');
  await expect(page.getByTestId('requests')).toHaveText('19 回');
});

test('the SDK call log opens to the input and output of each SDK command', async ({ page }) => {
  const title = SEEDS[2];
  await page.getByRole('checkbox', { name: `「${title}」を完了にする` }).check();
  // Nothing is shown under the Todo itself.
  await expect(item(page, title).getByRole('list')).toHaveCount(0);
  const log = page.getByRole('region', { name: 'SDK の呼び出し' });
  const rows = log.getByRole('list', { name: `「${title}」を完了にする の SDK 呼び出し` }).getByRole('listitem');
  await expect(rows).toHaveText([
    /DynamoDB.*docs\.send\(UpdateCommand\).*UpdateItem.*200/,
    /SQS.*sqs\.send\(SendMessageCommand\).*200/,
    /Scan/,
    /ReceiveMessage/,
    /DeleteMessageBatch/,
    /ReceiveMessage/,
  ]);
  // The row opens to what backend.js passed to the SDK, and what came back.
  const update = rows.filter({ hasText: 'UpdateCommand' });
  await update.locator('summary').click();
  const input = JSON.parse(await update.getByLabel(/の入力$/).textContent());
  expect(input).toMatchObject({ TableName: 'todos', UpdateExpression: 'SET done = :done', ExpressionAttributeValues: { ':done': true } });
  const output = JSON.parse(await update.getByLabel(/の出力$/).textContent());
  expect(output.Attributes).toMatchObject({ title, done: true });

  // A note that does not exist yet: S3 answers NoSuchKey, and the handler treats it as an empty note.
  const other = SEEDS[1];
  await page.getByRole('button', { name: `「${other}」のメモ` }).click();
  const get = log.getByRole('list', { name: `「${other}」のメモを開く の SDK 呼び出し` }).getByRole('listitem').first();
  await expect(get).toContainText(/s3\.send\(GetObjectCommand\).*404/);
  await get.locator('summary').click();
  await expect(get.getByLabel(/のエラー$/)).toHaveText(/^NoSuchKey: /);
});

test('no horizontal scrolling and the Geist fonts are served from the site', async ({ page }) => {
  const { sw, cw, fonts } = await page.evaluate(async () => {
    await document.fonts.ready;
    return {
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
      fonts: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family),
    };
  });
  expect(sw).toBeLessThanOrEqual(cw);
  expect(fonts).toEqual(expect.arrayContaining(['Geist']));
});
