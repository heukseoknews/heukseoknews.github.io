/** 사이트 공통(채널과 무관) 정보. 채널별 이름·부제·탭·필터 라벨은 channels/<채널>/channel.json. */
export const SITE = {
  name: '흑석일보',
  nameEn: 'Heukseok Ilbo',
  subtitle: '보험·AI·금융 뉴스 모아보기',
  url: 'https://heukseoknews.github.io/',
  issues: 'https://github.com/heukseoknews/heukseoknews.github.io/issues',
  author: 'Seungu Sin',
  notice: '개인이 운영하는 비공식 프로젝트이며 기사의 저작권은 각 언론사에 있습니다.',
} as const;
