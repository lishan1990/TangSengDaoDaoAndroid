package com.chat.uikit.chat.msgmodel;

import android.os.Parcel;

import androidx.annotation.NonNull;

import com.chat.uikit.R;
import com.chat.uikit.WKUIKitApplication;
import com.xinbida.wukongim.message.type.WKMsgContentType;
import com.xinbida.wukongim.msgmodel.WKMediaMessageContent;
import com.xinbida.wukongim.msgmodel.WKMessageContent;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * 文件消息（与 Web 端保持兼容：payload 为 {"url","name","size"}）
 */
public class WKFileContent extends WKMediaMessageContent {
    public WKFileContent() {
        type = WKMsgContentType.WK_FILE;
    }

    public String name;
    public long size;

    @NonNull
    @Override
    public JSONObject encodeMsg() {
        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("url", url == null ? "" : url);
            jsonObject.put("name", name == null ? "" : name);
            jsonObject.put("size", size);
        } catch (JSONException e) {
            e.printStackTrace();
        }
        return jsonObject;
    }

    @Override
    public WKMessageContent decodeMsg(JSONObject jsonObject) {
        url = jsonObject.optString("url");
        name = jsonObject.optString("name");
        size = jsonObject.optLong("size");
        return this;
    }

    protected WKFileContent(Parcel in) {
        super(in);
        name = in.readString();
        size = in.readLong();
    }

    @Override
    public void writeToParcel(Parcel dest, int flags) {
        super.writeToParcel(dest, flags);
        dest.writeString(name);
        dest.writeLong(size);
    }

    public static final Creator<WKFileContent> CREATOR = new Creator<WKFileContent>() {
        @Override
        public WKFileContent createFromParcel(Parcel in) {
            return new WKFileContent(in);
        }

        @Override
        public WKFileContent[] newArray(int size) {
            return new WKFileContent[size];
        }
    };

    @Override
    public int describeContents() {
        return 0;
    }

    @NonNull
    @Override
    public String getDisplayContent() {
        if (!android.text.TextUtils.isEmpty(name))
            return WKUIKitApplication.getInstance().getContext().getString(R.string.chat_file_prefix) + name;
        return WKUIKitApplication.getInstance().getContext().getString(R.string.chat_file_prefix);
    }

    @NonNull
    @Override
    public String getSearchableWord() {
        return name == null ? "" : name;
    }

    public String getShowSize() {
        if (size <= 0) return "";
        if (size < 1024) return size + "B";
        if (size < 1024 * 1024) return String.format("%.1fKB", size / 1024f);
        return String.format("%.1fMB", size / 1024f / 1024f);
    }
}
