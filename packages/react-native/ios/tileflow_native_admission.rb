# Call after $MLRN.post_install(installer) in the existing local Podfile.
# This only links the already configured pinned SPM product to this pod and
# its local test targets. It never installs a shell phase or changes a pin.
def tileflow_native_admission_post_install(installer)
	project = installer.pods_project
	url = 'https://github.com/maplibre/maplibre-gl-native-distribution'
	version = '6.26.0'
	refs = project.root_object.package_references.select do |reference|
		reference.respond_to?(:repositoryURL) && reference.repositoryURL == url
	end
	raise 'Run MapLibre React Native post_install before Tileflow native admission' unless refs.length == 1
	reference = refs.first
	requirement = reference.requirement.transform_keys(&:to_s)
	unless requirement == { 'kind' => 'exactVersion', 'version' => version }
		raise 'Tileflow native admission requires the exact MapLibre Native 6.26.0 SPM product'
	end
	if defined?($MLRN_NATIVE_VERSION) && $MLRN_NATIVE_VERSION.to_s != version
		raise 'Conflicting MapLibre Native version for Tileflow native admission'
	end

	targets = project.targets.select do |target|
		target.name == 'TileflowNativeAdmission' || target.name.start_with?('TileflowNativeAdmission-', 'AppHost-TileflowNativeAdmission-')
	end
	raise 'TileflowNativeAdmission pod target is missing' unless targets.any? { |target| target.name == 'TileflowNativeAdmission' }
	targets.each do |target|
		products = target.package_product_dependencies.select { |product| product.product_name == 'MapLibre' }
		if products.any? { |product| product.package != reference } || products.length > 1
			raise 'Conflicting MapLibre product on Tileflow native admission target'
		end
		product = products.first
		unless product
			product = project.new(Xcodeproj::Project::Object::XCSwiftPackageProductDependency)
			product.package = reference
			product.product_name = 'MapLibre'
			target.package_product_dependencies << product
		end
		phase = target.frameworks_build_phase
		unless phase.files.any? { |file| file.respond_to?(:product_ref) && file.product_ref == product }
			file = project.new(Xcodeproj::Project::Object::PBXBuildFile)
			file.product_ref = product
			phase.files << file
		end
	end
end
