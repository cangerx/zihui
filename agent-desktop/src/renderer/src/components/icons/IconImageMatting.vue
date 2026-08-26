<template>
  <!--
    AI 抠图图标：剪刀 + 主体轮廓，象征"分离背景"。
    设计语言与 IconImage2Prompt / IconImageGen 等保持一致：
      - 24x24 viewBox
      - stroke-width 2 / linecap round / linejoin round
      - 纯线条 + 单色（currentColor）
  -->
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <!-- 剪刀双环 -->
    <circle cx="6" cy="6" r="3"/>
    <circle cx="6" cy="18" r="3"/>
    <!-- 剪刀交叉手柄 → 刀尖 -->
    <path d="M8.12 8.12 20 20"/>
    <path d="M14.8 14.8 20 4"/>
    <path d="m8.12 15.88 5.88-5.88"/>
  </svg>
</template>
