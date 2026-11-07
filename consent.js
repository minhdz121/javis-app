export const CONSENT_VERSION = "2026-11-07.5";
// Minh yêu cầu bỏ 3 lưu ý đầu (07/11/2026): giữ phiên Zalo/đọc-gửi tin, bên thứ ba, rủi ro khóa tài khoản.
export const CONSENT_NOTICES = [];
export const CONSENT_ITEMS = [
  { id: "revoke", title: "Cách thu hồi", text: "Bấm nút \"Xóa dữ liệu của tôi và gỡ\" trong ứng dụng bất cứ lúc nào để xóa phiên Zalo khỏi máy của Minh. Để chắc chắn, hãy tự đăng xuất thiết bị lạ trong phần thiết bị đã đăng nhập của Zalo. Minh cũng có thể thu hồi Javis của bạn bất cứ lúc nào." },
  { id: "nostore", title: "Tin của người khác không bị lưu", text: "Javis không lưu nội dung tin của người khác trong nhóm của bạn; chỉ giữ trạng thái kỹ thuật như bật/tắt từng nhóm." },
];
