export async function formatIstanbul(db: IDBDatabase) {
  const tx = db.transaction(['maps', 'counts'], 'readonly');
  const [maps, counts]: any[] = await Promise.all([
    new Promise((resolve, reject) => {
      const request = tx.objectStore('maps').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }),
    new Promise((resolve, reject) => {
      const request = tx.objectStore('counts').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    })
  ]);

  const mapPathToMaps = new Map(maps.map((map: any) => [map.path, map]));
  const entries = counts.map((count: any) => {
    const map: any = mapPathToMaps.get(count.path);
    const obj = {
      path: count.path,
      statementMap: cvtArrayToObject(map!.statementMap),
      fnMap: cvtArrayToObject(map!.fnMap),
      branchMap: cvtArrayToObject(map!.branchMap),
      s: cvtArrayToObject(count.s),
      f: cvtArrayToObject(count.f),
      b: cvtArrayToObject(count.b)
    };
    return [count.path, obj];
  });
  return Object.fromEntries(entries);
}

function cvtArrayToObject<T>(a: Array<T>): { [key: number]: T } {
  return Object.fromEntries(a.map((value, index) => [index + 1, value]));
}