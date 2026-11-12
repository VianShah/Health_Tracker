import PhotosUI
import SwiftUI
#if canImport(NutriScanShared)
import NutriScanShared
#endif

struct ScanView: View {
    @EnvironmentObject private var model: AppModel
    @EnvironmentObject private var profile: ProfileStore
    @EnvironmentObject private var session: SessionStore

    @State private var mode: ScanModeOption = .plate
    @State private var images: [PickedImage] = []
    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var showCamera = false
    @State private var mealType = "Auto"
    @State private var mealTime = Date.now
    @State private var notes = ""
    @State private var analyzing = false
    @State private var error: String?
    @State private var result: ScanResult?

    private let maxImages = 4
    private let mealTypes = ["Auto", "Breakfast", "Lunch", "Snack", "Dinner"]

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Scan type", selection: $mode) {
                        ForEach(ScanModeOption.allCases) { m in
                            Label(m.title, systemImage: m.symbol).tag(m)
                        }
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                    Text(mode.blurb).font(.footnote).foregroundStyle(.secondary)
                }

                Section("Photos") {
                    if !images.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 10) {
                                ForEach(images) { picked in
                                    Image(uiImage: picked.image)
                                        .resizable().scaledToFill()
                                        .frame(width: 96, height: 120)
                                        .clipShape(RoundedRectangle(cornerRadius: 12))
                                        .overlay(alignment: .topTrailing) {
                                            Button { images.removeAll { $0.id == picked.id } } label: {
                                                Image(systemName: "xmark.circle.fill")
                                                    .symbolRenderingMode(.palette)
                                                    .foregroundStyle(.white, .black.opacity(0.6))
                                                    .font(.title3)
                                            }
                                            .padding(4)
                                        }
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    }
                    HStack {
                        Button {
                            showCamera = true
                        } label: {
                            Label("Camera", systemImage: "camera.fill").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(!UIImagePickerController.isSourceTypeAvailable(.camera) || images.count >= maxImages)

                        PhotosPicker(selection: $pickerItems, maxSelectionCount: maxImages - images.count, matching: .images) {
                            Label("Library", systemImage: "photo.on.rectangle").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .disabled(images.count >= maxImages)
                    }
                    Text(mode == .receipt ? "Long bill? Add up to \(maxImages) photos, top to bottom." : "Up to \(maxImages) photos.")
                        .font(.caption).foregroundStyle(.secondary)
                }

                if mode == .plate {
                    Section("Meal") {
                        Picker("Meal", selection: $mealType) {
                            ForEach(mealTypes, id: \.self) { Text($0) }
                        }
                        DatePicker("Eaten at", selection: $mealTime, in: ...Date.now, displayedComponents: [.date, .hourAndMinute])
                    }
                }

                Section("Notes (optional)") {
                    TextField(mode == .menu ? "e.g. high protein, no fried food" : "e.g. half portion of rice", text: $notes, axis: .vertical)
                        .lineLimit(1...3)
                }

                if session.session?.isLinkedToBN == false && profile.isLocalProfileEmpty {
                    Section {
                        NavigationLink {
                            ProfileEditorView()
                        } label: {
                            Label("Add allergies & goals for personal advice", systemImage: "person.text.rectangle")
                                .font(.footnote)
                        }
                    }
                }

                if let error {
                    Section { ErrorBanner(message: error).listRowInsets(EdgeInsets()) }
                }

                Section {
                    Button {
                        Task { await analyze() }
                    } label: {
                        HStack {
                            Spacer()
                            if analyzing {
                                ProgressView().tint(.white)
                                Text("Analysing…")
                            } else {
                                Image(systemName: "sparkles")
                                Text("Analyse \(mode.title.lowercased())")
                            }
                            Spacer()
                        }
                        .font(.headline)
                        .padding(.vertical, 6)
                    }
                    .buttonStyle(.borderedProminent)
                    .listRowInsets(EdgeInsets())
                    .disabled(images.isEmpty || analyzing)
                }
            }
            .navigationTitle("Scan")
            .navigationDestination(item: $result) { r in
                ScanResultView(result: r)
            }
            .fullScreenCover(isPresented: $showCamera) {
                CameraPicker { image in
                    if let image { images.append(PickedImage(image: image)) }
                }
                .ignoresSafeArea()
            }
            .onChange(of: pickerItems) { _, items in
                Task { await loadPicked(items) }
            }
            .onChange(of: mode) { _, _ in error = nil }
            .onAppear(perform: applyRequestedMode)
            .onChange(of: model.requestedScanMode) { _, _ in applyRequestedMode() }
        }
    }

    private func applyRequestedMode() {
        guard let requested = model.requestedScanMode else { return }
        mode = requested
        model.requestedScanMode = nil
        result = nil
        if images.isEmpty && UIImagePickerController.isSourceTypeAvailable(.camera) { showCamera = true }
    }

    private func loadPicked(_ items: [PhotosPickerItem]) async {
        guard !items.isEmpty else { return }
        for item in items {
            if images.count >= maxImages { break }
            if let data = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: data) {
                images.append(PickedImage(image: img))
            }
        }
        pickerItems = []
    }

    private func analyze() async {
        analyzing = true; error = nil
        defer { analyzing = false }

        let currentMode = mode
        let photos = images.map(\.image)
        let jpegs = await Task.detached(priority: .userInitiated) {
            photos.compactMap { ImageCompressor.jpeg(for: $0, mode: currentMode) }
        }.value
        guard !jpegs.isEmpty else { error = "Couldn't read those photos."; return }

        let time = currentMode == .plate ? min(mealTime, .now) : .now
        let profileDict = await profile.profileForScan(session: session.session)
        do {
            let r = try await model.api.analyze(images: jpegs, mode: currentMode, profile: profileDict, mealTime: time,
                                                mealType: mealType == "Auto" ? nil : mealType, notes: notes)
            var withDate = r
            withDate.date = time
            model.didFinishScan(withDate)
            result = withDate
            images = []
            notes = ""
            mealTime = .now
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct PickedImage: Identifiable {
    let id = UUID()
    let image: UIImage
}

/// UIKit camera wrapped for SwiftUI.
struct CameraPicker: UIViewControllerRepresentable {
    var onDone: (UIImage?) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let p = UIImagePickerController()
        p.sourceType = .camera
        p.cameraCaptureMode = .photo
        p.delegate = context.coordinator
        return p
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            parent.onDone(info[.originalImage] as? UIImage)
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.onDone(nil)
            parent.dismiss()
        }
    }
}
