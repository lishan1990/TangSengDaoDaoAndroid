package com.chat.uikit.chat.provider

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.text.TextUtils
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import com.chat.base.msgitem.WKChatBaseProvider
import com.chat.base.msgitem.WKChatIteMsgFromType
import com.chat.base.msgitem.WKContentType
import com.chat.base.msgitem.WKUIChatMsgItemEntity
import com.chat.base.views.BubbleLayout
import com.chat.uikit.R
import com.chat.uikit.chat.msgmodel.WKFileContent

/**
 * 文件消息渲染：点击使用系统 DownloadManager 下载到「下载」目录，完成后可在通知栏打开
 */
class WKFileProvider : WKChatBaseProvider() {
    override fun getChatViewItem(parentView: ViewGroup, from: WKChatIteMsgFromType): View? {
        return LayoutInflater.from(context).inflate(R.layout.chat_item_file, parentView, false)
    }

    override fun setData(
        adapterPosition: Int,
        parentView: View,
        uiChatMsgItemEntity: WKUIChatMsgItemEntity,
        from: WKChatIteMsgFromType
    ) {
        val fileContent = uiChatMsgItemEntity.wkMsg.baseContentMsgModel as? WKFileContent ?: return
        val nameTv = parentView.findViewById<TextView>(R.id.fileNameTv)
        val sizeTv = parentView.findViewById<TextView>(R.id.fileSizeTv)
        nameTv.text = if (TextUtils.isEmpty(fileContent.name)) context.getString(R.string.chat_file_default_name) else fileContent.name
        sizeTv.text = fileContent.getShowSize()

        val contentLayout = parentView.findViewById<BubbleLayout>(R.id.contentLayout)
        val lp = contentLayout.layoutParams
        lp.width = LinearLayout.LayoutParams.WRAP_CONTENT
        contentLayout.layoutParams = lp

        contentLayout.setOnClickListener {
            val url = fileContent.url
            if (TextUtils.isEmpty(url)) {
                Toast.makeText(context, context.getString(R.string.chat_file_not_ready), Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            try {
                val req = DownloadManager.Request(Uri.parse(url))
                    .setTitle(fileContent.name ?: context.getString(R.string.chat_file_default_name))
                    .setDescription(context.getString(R.string.chat_file_downloading))
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, sanitize(fileContent.name))
                    .setAllowedOverMetered(true)
                    .setAllowedOverRoaming(true)
                (context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(req)
                Toast.makeText(context, context.getString(R.string.chat_file_task_created), Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                Toast.makeText(context, context.getString(R.string.chat_file_download_err), Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun sanitize(name: String?): String {
        val n = name ?: "file"
        val cleaned = n.replace(Regex("[\\\\/:*?\"<>|]"), "_")
        return if (cleaned.length > 80) cleaned.substring(0, 80) else cleaned
    }

    override val itemViewType: Int
        get() = WKContentType.WK_FILE

    override fun resetCellBackground(
        parentView: View,
        uiChatMsgItemEntity: WKUIChatMsgItemEntity,
        from: WKChatIteMsgFromType
    ) {
        super.resetCellBackground(parentView, uiChatMsgItemEntity, from)
        val bgType = getMsgBgType(
            uiChatMsgItemEntity.previousMsg,
            uiChatMsgItemEntity.wkMsg,
            uiChatMsgItemEntity.nextMsg
        )
        val contentLayout = parentView.findViewById<BubbleLayout>(R.id.contentLayout)
        contentLayout.setAll(bgType, from, WKContentType.WK_FILE)
    }

    override fun resetCellListener(
        position: Int,
        parentView: View,
        uiChatMsgItemEntity: WKUIChatMsgItemEntity,
        from: WKChatIteMsgFromType
    ) {
        super.resetCellListener(position, parentView, uiChatMsgItemEntity, from)
        val contentLayout = parentView.findViewById<BubbleLayout>(R.id.contentLayout)
        addLongClick(contentLayout, uiChatMsgItemEntity)
    }
}
