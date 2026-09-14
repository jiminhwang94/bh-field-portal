// IndexedDB 최소 래퍼 — 외부 라이브러리 없이 Promise 로 감싼다.
// 이 앱의 모든 데이터(가이드·차량·재고·항목·리포트·운행일지·사진)는 기기 안 이 DB 에 있다.

const DB_NAME = 'bh-field-portal';
// 저장소를 새로 추가하면 **이 숫자를 올려야** 이미 앱을 쓰던 기기에서도
// 만들어진다 (onupgradeneeded 는 번호가 올라갈 때만 불린다).
//   2 — 차량 운행 일지(driving)
const DB_VERSION = 2;

/** 저장소 정의: 이름 → { keyPath, indexes } */
export const STORES = {
  guides: { keyPath: 'id', indexes: [['categoryType', 'categoryType']] },
  vehicles: { keyPath: 'name' },
  inventory: { keyPath: 'id', indexes: [['vehicleName', 'vehicleName']] },
  quantities: { keyPath: 'key' },        // `${vehicleName}\u0000${partName}`
  fields: { keyPath: 'id' },
  driving: { keyPath: 'id', indexes: [['vehicleName', 'vehicleName']] },
  reports: { keyPath: 'id' },
  media: { keyPath: 'filename' },        // { filename, blob, mime, originalName, size, localOnly }
  outbox: { keyPath: 'id', autoIncrement: true },
  meta: { keyPath: 'key' },              // 설정·동기화 상태
};

let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const [name, spec] of Object.entries(STORES)) {
        if (db.objectStoreNames.contains(name)) continue;
        const store = db.createObjectStore(name, {
          keyPath: spec.keyPath,
          autoIncrement: !!spec.autoIncrement,
        });
        for (const [indexName, keyPath] of spec.indexes || []) {
          store.createIndex(indexName, keyPath);
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('다른 탭에서 앱이 열려 있어 저장소를 열 수 없습니다.'));
  });
  return dbPromise;
}

function run(storeNames, mode, work) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('저장소 작업이 중단되었습니다.'));
    result = work(tx);
    if (result && typeof result.then === 'function') {
      // work 가 Promise 를 돌려주면 그 값을 기다린다(트랜잭션은 자동 커밋).
      result.then((value) => { result = value; }, reject);
    }
  }));
}

const wrap = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

export async function get(store, key) {
  const db = await openDb();
  return wrap(db.transaction(store, 'readonly').objectStore(store).get(key));
}

export async function getAll(store, indexName = null, query = null) {
  const db = await openDb();
  const source = db.transaction(store, 'readonly').objectStore(store);
  const target = indexName ? source.index(indexName) : source;
  return wrap(target.getAll(query));
}

export async function put(store, value) {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  const request = tx.objectStore(store).put(value);
  await wrap(request);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
  });
}

export async function putAll(store, values) {
  if (!values.length) return 0;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const objectStore = tx.objectStore(store);
    values.forEach((value) => objectStore.put(value));
    tx.oncomplete = () => resolve(values.length);
    tx.onerror = () => reject(tx.error);
  });
}

export async function remove(store, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function clear(...stores) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite');
    stores.forEach((name) => tx.objectStore(name).clear());
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/** 여러 저장소를 한 트랜잭션에서 교체 (동기화 적용용) */
export async function replaceStores(payload) {
  const names = Object.keys(payload);
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, 'readwrite');
    for (const [name, rows] of Object.entries(payload)) {
      const store = tx.objectStore(name);
      store.clear();
      (rows || []).forEach((row) => store.put(row));
    }
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function count(store) {
  const db = await openDb();
  return wrap(db.transaction(store, 'readonly').objectStore(store).count());
}

export { run };
