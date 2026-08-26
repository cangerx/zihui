<template>
  <!--
    精细抠图图标：剪刀 + 精修点，象征"沿边精细分离"。
    与 IconImageMatting（快速抠图，纯剪刀）区分：右侧增加一个实心精修点。
    设计语言一致：24x24 / stroke-width 2 / linecap round / linejoin round / 单色 currentColor。
  -->
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <!-- 剪刀双环 -->
    <circle cx="6" cy="6" r="3"/>
    <circle cx="6" cy="18" r="3"/>
    <!-- 剪刀交叉手柄 → 刀尖 -->
    <path d="M8.12 8.12 20 20"/>
    <path d="M14.8 14.8 20 4"/>
    <path d="m8.12 15.88 5.88-5.88"/>
    <!-- 精修点（区分快速抠图） -->
    <circle cx="18.6" cy="13.4" r="1.05" fill="currentColor" stroke="none"/>
  </svg>
</template>
