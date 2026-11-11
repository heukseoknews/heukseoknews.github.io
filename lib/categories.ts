import cfg from '../config/categories.json';

/** 카테고리 버튼 목록·순서는 config/categories.json 의 categories 키 순서를 그대로 쓴다(카테고리 추가·삭제는 그 파일만 고친다). */
export const CATEGORIES: string[] = Object.keys(cfg.categories);
