import UIKit

/// Shrinks photos before upload. The API forwards images under ~450 KB
/// straight to the model and only re-compresses bigger ones server-side,
/// so staying under that keeps scans fast.
enum ImageCompressor {
    static func jpeg(for image: UIImage, mode: ScanModeOption, maxBytes: Int = 440_000) -> Data? {
        // Receipts and menus are text: keep more pixels so small print stays legible.
        let maxSide: CGFloat = mode == .plate ? 1280 : 1800
        let resized = image.resized(maxSide: maxSide)

        var quality: CGFloat = 0.8
        var data = resized.jpegData(compressionQuality: quality)
        while let d = data, d.count > maxBytes, quality > 0.3 {
            quality -= 0.1
            data = resized.jpegData(compressionQuality: quality)
        }
        if let d = data, d.count > maxBytes {
            // Still too big (very detailed photo): drop resolution further.
            data = resized.resized(maxSide: maxSide * 0.75).jpegData(compressionQuality: 0.5)
        }
        return data
    }
}

extension UIImage {
    func resized(maxSide: CGFloat) -> UIImage {
        let longest = max(size.width, size.height)
        guard longest > maxSide else { return normalizedOrientation() }
        let scale = maxSide / longest
        let target = CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in
            draw(in: CGRect(origin: .zero, size: target))
        }
    }

    func normalizedOrientation() -> UIImage {
        guard imageOrientation != .up else { return self }
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = scale
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in draw(at: .zero) }
    }
}
