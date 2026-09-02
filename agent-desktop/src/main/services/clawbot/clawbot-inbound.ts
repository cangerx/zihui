// 入站消息解析：WeixinMessage → 对话引擎可消费的 { content, attachments }。
// 类型承接（对照开发计划 §5.5）：
//   文字 → 直接作 content
//   图片 → 下载解密 + nativeImage 压缩(≤1024px jpeg 0.8) → image 附件（data:image/ 前缀硬要求）
//   文件 → 文档白名单内下载解密 + parseDocumentFromBuffer 转文本 → document 附件；白名单外降级文字说明
//   语音 → 用服务端 ASR 文本（VoiceItem.text），为空则提示不支持
//   视频 → 降级提示
//   引用(ref_msg) → 有文本时拼入上下文
//   群消息 → 由桥接层在上游直接丢弃（group_id 非空）

import { nativeImage } from 'electron'
import { downloadMedia } from './ilink-cdn'
import { MESSAGE_ITEM_TYPE } from './ilink-types'
import type { MessageItem, WeixinMessage } from './ilink-types'
import { parseDocumentFromBuffer } from '../document-parser'

/** 与渲染层 ChatView 对齐的文档白名单（这些类型能被解析成文本；.ppt 进白名单只为给出"请转 pptx"的精准提示） */
const DOC_EXTENSIONS = new Set(['txt', 'md', 'pdf', 'psd', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'json', 'pptx', 'ppt'])
/** 与 ChatView 的 MAX_ATTACHMENTS 对齐 */
const MAX_ATTACHMENTS = 5
/** 与 ChatView compressImage 对齐：最长边 1024、jpeg 0.8 */
const IMAGE_MAX_SIDE = 1024
const IMAGE_JPEG_QUALITY = 80
/** 单条入站媒体体积上限（防御：避免超大文件拖垮内存与上下文） */
const MAX_MEDIA_BYTES = 20 * 1024 * 1024

export interface InboundParsed {
  /** message=正常注入对话；unsupported=无需进引擎，直接回发 notice */
  kind: 'message' | 'unsupported'
  content: string
  attachments?: Array<{ name: string; type: 'image' | 'document'; data: string }>
  /** 日志用：text/image/file/voice/video/mixed */
  msgType: string
  /** 日志摘要 */
  summary: string
  /** unsupported 时回发用户的提示文案 */
  notice?: string
}

/** nativeImage 压缩到 ≤1024px、JPEG 80%；无法解码时返回 null（调用方按非图片处理） */
function compressImage(plain: Buffer): Buffer | null {
  try {
    const img = nativeImage.createFromBuffer(plain)
    if (img.isEmpty()) return null
    const { width, height } = img.getSize()
    let out = img
    if (Math.max(width, height) > IMAGE_MAX_SIDE) {
      const scale = IMAGE_MAX_SIDE / Math.max(width, height)
      out = img.resize({
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
        quality: 'good'
      })
    }
    return out.toJPEG(IMAGE_JPEG_QUALITY)
  } catch {
    return null
  }
}

function extOf(name: string): string {
  const idx = name.lastIndexOf('.')
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : ''
}

/** 引用消息文本提取（仅文本类引用进入上下文；媒体引用不下载） */
function extractRefText(item: MessageItem): string {
  const ref = item.ref_msg
  if (!ref) return ''
  const parts: string[] = []
  if (ref.title) parts.push(ref.title)
  const refItem = ref.message_item
  if (refItem?.type === MESSAGE_ITEM_TYPE.TEXT && refItem.text_item?.text) {
    parts.push(refItem.text_item.text)
  }
  return parts.filter(Boolean).join('：').slice(0, 300)
}

async function processImageItem(item: MessageItem, index: number): Promise<{ name: string; type: 'image'; data: string } | null> {
  const image = item.image_item
  if (!image?.media) return null
  const plain = await downloadMedia(image.media, image.aeskey)
  if (plain.length > MAX_MEDIA_BYTES) return null
  const compressed = compressImage(plain)
  if (!compressed) return null
  return {
    name: `wechat-image-${index + 1}.jpg`,
    type: 'image',
    data: `data:image/jpeg;base64,${compressed.toString('base64')}`
  }
}

async function processFileItem(item: MessageItem): Promise<{ attachment?: { name: string; type: 'document'; data: string }; note?: string }> {
  const file = item.file_item
  const name = file?.file_name || '未命名文件'
  if (!file?.media) return { note: `[收到文件「${name}」，但无法下载]` }
  const ext = extOf(name)
  if (!DOC_EXTENSIONS.has(ext)) {
    return { note: `[收到文件「${name}」，该类型暂不支持解析（支持 ${[...DOC_EXTENSIONS].join('/')}）]` }
  }
  const plain = await downloadMedia(file.media)
  if (plain.length > MAX_MEDIA_BYTES) return { note: `[收到文件「${name}」，文件过大无法处理]` }
  const parsed = await parseDocumentFromBuffer(plain, ext)
  if (!parsed.ok) {
    return { note: `[收到文件「${name}」，解析失败：${parsed.error || '无法提取文本'}]` }
  }
  return { attachment: { name, type: 'document', data: parsed.text } }
}

export async function processInboundMessage(msg: WeixinMessage): Promise<InboundParsed> {
  const items = (msg.item_list || []).filter((it) => it && it.type !== MESSAGE_ITEM_TYPE.NONE)
  const textParts: string[] = []
  const notes: string[] = []
  const attachments: Array<{ name: string; type: 'image' | 'document'; data: string }> = []
  const typeSet = new Set<string>()
  let sawVoice = false
  let sawVideo = false

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    // 引用文本（任意主类型都可能带）
    const refText = extractRefText(item)
    if (refText) textParts.push(`> 引用：${refText}`)

    switch (item.type) {
      case MESSAGE_ITEM_TYPE.TEXT: {
        typeSet.add('text')
        const t = item.text_item?.text?.trim()
        if (t) textParts.push(t)
        break
      }
      case MESSAGE_ITEM_TYPE.IMAGE: {
        typeSet.add('image')
        if (attachments.length < MAX_ATTACHMENTS) {
          try {
            const att = await processImageItem(item, i)
            if (att) attachments.push(att)
            else notes.push('[有一张图片无法识别]')
          } catch (e) {
            console.error('[clawbot] inbound image failed:', e)
            notes.push('[有一张图片下载失败]')
          }
        }
        break
      }
      case MESSAGE_ITEM_TYPE.FILE: {
        typeSet.add('file')
        if (attachments.length < MAX_ATTACHMENTS) {
          try {
            const r = await processFileItem(item)
            if (r.attachment) attachments.push(r.attachment)
            if (r.note) notes.push(r.note)
          } catch (e) {
            console.error('[clawbot] inbound file failed:', e)
            notes.push(`[文件「${item.file_item?.file_name || ''}」下载失败]`)
          }
        }
        break
      }
      case MESSAGE_ITEM_TYPE.VOICE: {
        typeSet.add('voice')
        sawVoice = true
        const asr = item.voice_item?.text?.trim()
        if (asr) textParts.push(`[语音转文字] ${asr}`)
        break
      }
      case MESSAGE_ITEM_TYPE.VIDEO: {
        typeSet.add('video')
        sawVideo = true
        break
      }
      default:
        break
    }
  }

  // 降级备注并入正文（让模型/用户都可见）
  const content = [...textParts, ...notes].join('\n').trim()
  const msgType = typeSet.size === 1 ? [...typeSet][0] : typeSet.size > 1 ? 'mixed' : 'unknown'

  // 完全无可注入内容时的降级回复
  if (!content && attachments.length === 0) {
    if (sawVoice) {
      return { kind: 'unsupported', content: '', msgType: 'voice', summary: '语音消息（无识别文本）', notice: '暂时无法识别这条语音，请发文字或图片。' }
    }
    if (sawVideo) {
      return { kind: 'unsupported', content: '', msgType: 'video', summary: '视频消息', notice: '暂不支持视频消息，请发文字、图片或文档。' }
    }
    return { kind: 'unsupported', content: '', msgType, summary: '无法识别的消息', notice: '暂不支持这类消息，请发文字、图片或文档。' }
  }
  // 纯视频/语音无文本且还有其他内容时，内容照常进引擎，notice 为空

  const summaryBase = content || attachments.map((a) => `[${a.type}:${a.name}]`).join(' ')
  return {
    kind: 'message',
    content: content || '（请查看我发送的内容）',
    attachments: attachments.length ? attachments : undefined,
    msgType,
    summary: summaryBase.slice(0, 200)
  }
}
