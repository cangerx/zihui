<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'

onLaunch(() => {
  // 预留：读取本地登录态、上报启动
})
</script>

<style lang="scss">
page {
  background-color: $bg-page;
  font-size: $fs-body;
  color: $ink;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', Helvetica, sans-serif;
}

view,
text,
image,
scroll-view,
swiper {
  box-sizing: border-box;
}

/* 单行 / 多行省略 */
.ellipsis {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.ellipsis-2 {
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
</style>
