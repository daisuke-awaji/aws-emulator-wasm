import { expect, test } from '@playwright/test';

// The Todo page keeps the emulator's state in OPFS: a snapshot of the wasm memory, saved
// when requests pause. Every test starts in a fresh browser context (empty storage).

const SEEDS = ['AWS Emulator を wasm にビルドする', 'ブラウザの Worker で動かす', 'MSW のハンドラから DynamoDB・S3・SQS を呼ぶ'];

const items = (page) => page.getByRole('list', { name: 'Todo の一覧' }).locator(':scope > li');
const item = (page, title) => items(page).filter({ has: page.locator(':scope > .row', { hasText: title }) });
const notice = (page) => page.getByTestId('persist-notice');

async function open(page) {
  await page.goto('./');
  await expect(items(page).first()).toBeVisible({ timeout: 60_000 });
}

/** Waits until the last save covers every SDK call the page has made. */
async function saved(page) {
  // The counter is read at the end of each action; the buttons come back after that.
  await expect(page.getByRole('button', { name: '追加' })).toBeEnabled();
  await expect(async () => {
    const total = Number.parseInt(await page.getByTestId('requests').textContent(), 10);
    const covered = Number(await page.getByTestId('last-save').getAttribute('data-requests'));
    expect(covered).toBe(total);
  }).toPass({ timeout: 20_000 });
}

async function add(page, title) {
  await page.getByLabel('新しい Todo').fill(title);
  await page.getByRole('button', { name: '追加' }).click();
  await expect(item(page, title)).toBeVisible();
}

/** Rewrites the saved snapshots from the page (main thread OPFS). */
function editSnapshots(page, edit) {
  return page.evaluate(async (edit) => {
    const root = await navigator.storage.getDirectory();
    const dir = await (await root.getDirectoryHandle('aws-emulator-wasm')).getDirectoryHandle('todo-demo');
    const slots = [];
    for await (const [name, handle] of dir.entries()) {
      const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer());
      const length = new DataView(bytes.buffer).getUint32(4, true);
      const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + length)));
      slots.push({ name, handle, bytes, length, header });
    }
    slots.sort((a, b) => b.header.generation - a.header.generation);
    const write = async (slot, bytes) => {
      const w = await slot.handle.createWritable();
      await w.write(bytes);
      await w.close();
    };
    if (edit === 'other-build') {
      for (const slot of slots) {
        const header = new TextEncoder().encode(JSON.stringify({ ...slot.header, wasm: '0'.repeat(64) }));
        const out = new Uint8Array(8 + header.length + slot.bytes.length - 8 - slot.length);
        out.set(slot.bytes.subarray(0, 4));
        new DataView(out.buffer).setUint32(4, header.length, true);
        out.set(header, 8);
        out.set(slot.bytes.subarray(8 + slot.length), 8 + header.length);
        await write(slot, out);
      }
    } else if (edit === 'tear-newest') {
      await write(slots[0], slots[0].bytes.subarray(0, slots[0].bytes.length >> 1));
    }
    return slots.map((s) => s.header.generation);
  }, edit);
}

test('a reload keeps the todos, their state and their notes', async ({ page }) => {
  await open(page);
  await expect(notice(page)).toHaveCount(0);
  await add(page, '牛乳を買う');
  await page.getByRole('checkbox', { name: '「牛乳を買う」を完了にする' }).check();
  await expect(page.getByRole('checkbox', { name: '「牛乳を買う」を未完了に戻す' })).toBeChecked();
  await page.getByRole('button', { name: '「牛乳を買う」のメモ' }).click();
  await item(page, '牛乳を買う').getByLabel('メモ（S3 に保存）').fill('低脂肪のもの');
  await page.getByRole('button', { name: 'メモを保存' }).click();
  await expect(page.getByRole('button', { name: '「牛乳を買う」のメモ' })).toHaveText('メモあり');
  await saved(page);

  await page.reload();
  await expect(items(page)).toHaveCount(4, { timeout: 60_000 });
  await expect(notice(page)).toHaveText(/^前回の状態を復元しました/);
  // Restoring creates nothing: the boot is one GetQueueUrl, then the first Scan and receive.
  const boot = page.getByRole('region', { name: 'SDK の呼び出し' }).getByRole('list', { name: '起動（保存した状態を復元） の SDK 呼び出し' });
  await expect(boot.getByRole('listitem')).toHaveText([/GetQueueUrl/, /Scan/, /ReceiveMessage/]);
  await expect(page.getByRole('checkbox', { name: '「牛乳を買う」を未完了に戻す' })).toBeChecked();
  await expect(page.getByText('残り 1 件 / 全 4 件')).toBeVisible();
  await page.getByRole('button', { name: '「牛乳を買う」のメモ' }).click();
  await expect(item(page, '牛乳を買う').getByLabel('メモ（S3 に保存）')).toHaveValue('低脂肪のもの');

  // The restored emulator keeps working, and its next state survives another reload.
  await page.getByRole('button', { name: `「${SEEDS[1]}」を削除` }).click();
  await expect(item(page, SEEDS[1])).toHaveCount(0);
  await saved(page);
  await page.reload();
  await expect(items(page)).toHaveCount(3, { timeout: 60_000 });
  await expect(item(page, SEEDS[1])).toHaveCount(0);
  await expect(item(page, '牛乳を買う')).toBeVisible();
});

test('"初期状態に戻す" deletes the saved state and starts from the seed data', async ({ page }) => {
  await open(page);
  await add(page, '牛乳を買う');
  await saved(page);
  await page.getByRole('button', { name: '初期状態に戻す' }).click();
  const confirm = page.getByRole('group', { name: '初期状態に戻す' });
  await expect(confirm).toContainText('保存したデータを消して、最初の 3 件に戻します。');
  await confirm.getByRole('button', { name: 'やめる' }).click();
  await expect(item(page, '牛乳を買う')).toBeVisible();

  await page.getByRole('button', { name: '初期状態に戻す' }).click();
  await page.getByRole('button', { name: '消して戻す' }).click();
  await expect(items(page)).toHaveText(SEEDS.map((t) => new RegExp(t)), { timeout: 60_000 });
  await expect(notice(page)).toHaveCount(0);
  await expect(page.getByRole('list', { name: '起動（テーブル・バケット・キューの作成と初期データ） の SDK 呼び出し' })).toBeVisible();
});

test('a second tab waits for the first, and either can take the emulator over', async ({ page, context }) => {
  await open(page);
  await add(page, '牛乳を買う');
  await saved(page);

  const second = await context.newPage();
  await second.goto('./');
  await expect(second.getByRole('heading', { name: 'このデモは別のタブで開いています' })).toBeVisible({ timeout: 60_000 });
  await expect(second.getByText('待機中')).toBeVisible();
  await expect(items(second)).toHaveCount(0);

  // Take it over: the second tab restores what the first one saved; the first one stops.
  await second.getByRole('button', { name: 'このタブで使う' }).click();
  await expect(item(second, '牛乳を買う')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('heading', { name: '別のタブで使い始めたので、このタブは止めました' })).toBeVisible();
  await expect(items(page)).toHaveCount(0);
  await add(second, '卵を買う');
  await saved(second);

  // And back: the first tab reloads as the owner and sees the second tab's change.
  await page.getByRole('button', { name: 'このタブで使う' }).click();
  await expect(item(page, '卵を買う')).toBeVisible({ timeout: 60_000 });
  await expect(second.getByRole('heading', { name: '別のタブで使い始めたので、このタブは止めました' })).toBeVisible();

  // A waiting tab starts by itself once the owner closes.
  const third = await context.newPage();
  await third.goto('./');
  await expect(third.getByRole('heading', { name: 'このデモは別のタブで開いています' })).toBeVisible({ timeout: 60_000 });
  await page.close();
  await expect(item(third, '卵を買う')).toBeVisible({ timeout: 60_000 });
});

test('a snapshot from another wasm build is not used', async ({ page }) => {
  await open(page);
  await add(page, '牛乳を買う');
  await saved(page);
  expect((await editSnapshots(page, 'other-build')).length).toBeGreaterThan(0);
  await page.reload();
  await expect(items(page)).toHaveText(SEEDS.map((t) => new RegExp(t)), { timeout: 60_000 });
  await expect(notice(page)).toHaveText('エミュレーターが新しい版になったので、初期状態から始めました。');
});

test('a torn snapshot falls back to the one before it', async ({ page }) => {
  await open(page);
  await add(page, '牛乳を買う');
  await saved(page);
  await add(page, '卵を買う');
  await saved(page);
  await editSnapshots(page, 'tear-newest');
  await page.reload();
  await expect(notice(page)).toHaveText(/^最後の保存が壊れていたため、1 つ前の状態/, { timeout: 60_000 });
  await expect(item(page, '牛乳を買う')).toBeVisible();
  await expect(item(page, '卵を買う')).toHaveCount(0);
});
