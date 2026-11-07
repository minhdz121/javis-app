export const CONSENT_VERSION = "2026-11-07.1";
export const CONSENT_ITEMS = [
  { id: "keeper", title: "Minh giữ phiên Zalo của bạn", text: "Sau khi bạn quét QR, phiên đăng nhập Zalo của bạn nằm trên máy của Minh. Về mặt kỹ thuật, Minh đọc được mọi tin nhắn trong tài khoản của bạn và có thể gửi tin thay bạn. Javis được thiết kế chỉ trả lời khi được gọi tên, nhưng đó là sự tin tưởng chứ không phải rào chắn kỹ thuật tuyệt đối." },
  { id: "relay", title: "Nội dung gọi Javis đi qua bên thứ ba", text: "Khi ai đó gọi Javis, nội dung tin liên quan được gửi qua một dịch vụ trung chuyển (relay) của bên thứ ba rồi tới mô hình AI để trả lời. Đừng nhờ Javis xử lý thông tin bí mật." },
  { id: "lock", title: "Zalo có thể khóa tài khoản", text: "Javis dùng thư viện Zalo không chính thức, và nhiều tài khoản cùng đăng nhập từ một địa chỉ IP. Zalo có thể phát hiện và hạn chế hoặc khóa tài khoản của bạn. Bạn tự chấp nhận rủi ro này." },
  { id: "revoke", title: "Cách thu hồi", text: "Bấm nút \"Xóa dữ liệu của tôi và gỡ\" trong ứng dụng bất cứ lúc nào để xóa phiên Zalo khỏi máy của Minh. Để chắc chắn, hãy tự đăng xuất thiết bị lạ trong phần thiết bị đã đăng nhập của Zalo. Minh cũng có thể thu hồi Javis của bạn bất cứ lúc nào." },
  { id: "nostore", title: "Tin của người khác không bị lưu", text: "Javis không lưu nội dung tin của người khác trong nhóm của bạn; chỉ giữ trạng thái kỹ thuật như bật/tắt từng nhóm." },
];
