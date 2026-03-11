export async function mapWithConcurrency(items, concurrency, mapper) {
  const list = Array.isArray(items) ? items : [];
  const limit = Math.max(1, Number(concurrency || 1));
  const results = new Array(list.length);
  let index = 0;

  async function worker() {
    while (index < list.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await mapper(list[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, list.length || 1) }, () => worker()));
  return results;
}
