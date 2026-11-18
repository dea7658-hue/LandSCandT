import { test } from "node:test";
import assert from "node:assert/strict";
import { safeLink, validateItem } from "../server/validation.ts";
const item = {
  title: "카페",
  category: "food",
  address: "서울",
  note: "",
  assignee: "",
  date: "",
  done: false,
  url: "",
};
test("지도 링크는 HTTPS와 허용된 호스트만 사용", () => {
  assert.equal(safeLink("https://naver.me/hello"), "https://naver.me/hello");
  for (const url of [
    "javascript:alert(1)",
    "https://google.com.evil.org/a",
    "http://map.naver.com/",
  ])
    assert.throws(() => safeLink(url));
});
test("좌표 범위와 위경도 쌍 검증", () => {
  assert.throws(() => validateItem({ ...item, lat: 91, lng: 0 }));
  assert.throws(() => validateItem({ ...item, lat: 30 }));
  assert.equal(validateItem({ ...item, lat: 37.5, lng: 127 }).lat, 37.5);
});
test("제목과 카테고리, 날짜 검증", () => {
  assert.throws(() => validateItem({ ...item, title: "" }));
  assert.throws(() => validateItem({ ...item, category: "invalid" }));
  assert.throws(() => validateItem({ ...item, date: "tomorrow" }));
  assert.equal(validateItem(item).title, "카페");
});
